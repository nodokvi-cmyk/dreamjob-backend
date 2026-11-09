import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, UpdateQuery } from 'mongoose';
import { assertPdf, PDF_CONTENT_TYPE } from '../aws-s3/assert-pdf.js';
import { AwsS3Service } from '../aws-s3/aws-s3.service.js';
import {
  ImageKind,
  PROCESSED_IMAGE_CONTENT_TYPE,
  processImage,
} from '../aws-s3/process-image.js';
import { StoragePrefix } from '../aws-s3/storage-prefix.js';
import { CompaniesService } from '../companies/companies.service.js';
import { EmailClaimsService } from '../email-claims/email-claims.service.js';
import { hashChangedPassword } from '../shared/crypto/change-password.js';
import { ChangePasswordDto } from '../shared/dto/change-password.dto.js';
import { PaginationDto } from '../shared/dto/pagination.dto.js';
import { AuthRole } from '../shared/types/auth-role.js';
import type { EmailChangeStore } from '../shared/types/email-change-store.js';
import type { Viewer } from '../shared/types/viewer.js';
import { otpAttemptsLeftFilter } from '../shared/crypto/otp-attempts.js';
import { OtpPurpose } from '../shared/types/otp-purpose.js';
import { ContactVisibilityDto } from './dto/contact-visibility.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { User, UserDocument } from './schema/user.schema.js';

@Injectable()
export class UsersService implements EmailChangeStore {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly emailClaims: EmailClaimsService,
    private readonly s3: AwsS3Service,
    private readonly companiesService: CompaniesService,
  ) {}

  toResponse(user: UserDocument) {
    const { avatarKey, cvKey, ...rest } = user.toJSON();

    return {
      ...rest,
      avatarUrl: this.s3.publicUrl(avatarKey),
      hasCv: cvKey !== '',
    };
  }

  async setAvatar(id: string, file: Express.Multer.File) {
    const user = await this.findOne(id);
    const body = await processImage(file.buffer, ImageKind.AVATAR);
    const key = this.s3.newKey(StoragePrefix.AVATARS);

    await this.s3.upload(key, body, PROCESSED_IMAGE_CONTENT_TYPE);
    const updated = await this.userModel.findByIdAndUpdate(
      id,
      { $set: { avatarKey: key } },
      { new: true },
    );
    if (!updated) {
      await this.s3.deleteQuietly(key);
      throw new NotFoundException('User not found');
    }

    await this.s3.deleteQuietly(user.avatarKey);

    return this.toResponse(updated);
  }

  async removeAvatar(id: string) {
    const user = await this.findOne(id);
    if (!user.avatarKey) throw new NotFoundException('Avatar not found');

    const updated = await this.userModel.findByIdAndUpdate(
      id,
      { $set: { avatarKey: '' } },
      { new: true },
    );
    if (!updated) throw new NotFoundException('User not found');

    await this.s3.deleteQuietly(user.avatarKey);

    return this.toResponse(updated);
  }

  async setCv(id: string, file: Express.Multer.File) {
    assertPdf(file.buffer);
    const user = await this.findOne(id);
    const key = this.s3.newKey(StoragePrefix.CVS);

    await this.s3.upload(key, file.buffer, PDF_CONTENT_TYPE);
    const updated = await this.userModel.findByIdAndUpdate(
      id,
      { $set: { cvKey: key } },
      { new: true },
    );
    if (!updated) {
      await this.s3.deleteQuietly(key);
      throw new NotFoundException('User not found');
    }

    await this.s3.deleteQuietly(user.cvKey);

    return this.toResponse(updated);
  }

  async removeCv(id: string) {
    const user = await this.findOne(id);
    if (!user.cvKey) throw new NotFoundException('CV not found');

    const updated = await this.userModel.findByIdAndUpdate(
      id,
      { $set: { cvKey: '', isCvPublic: false } },
      { new: true },
    );
    if (!updated) throw new NotFoundException('User not found');

    await this.s3.deleteQuietly(user.cvKey);

    return this.toResponse(updated);
  }

  async setCvVisibility(id: string, isCvPublic: boolean) {
    const updated = await this.userModel.findByIdAndUpdate(
      id,
      { $set: { isCvPublic } },
      { new: true },
    );
    if (!updated) throw new NotFoundException('User not found');

    return this.toResponse(updated);
  }

  async setProfileVisibility(id: string, isProfilePublic: boolean) {
    const updated = await this.userModel.findByIdAndUpdate(
      id,
      { $set: { isProfilePublic } },
      { new: true },
    );
    if (!updated) throw new NotFoundException('User not found');

    return this.toResponse(updated);
  }

  async setContactVisibility({
    id,
    isEmailPublic,
    isPhonePublic,
  }: ContactVisibilityDto & { id: string }) {
    const changes: Partial<Pick<User, 'isEmailPublic' | 'isPhonePublic'>> = {};
    if (isEmailPublic !== undefined) changes.isEmailPublic = isEmailPublic;
    if (isPhonePublic !== undefined) changes.isPhonePublic = isPhonePublic;
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException(
        'Send isEmailPublic, isPhonePublic or both',
      );
    }

    const updated = await this.userModel.findByIdAndUpdate(
      id,
      { $set: changes },
      { new: true },
    );
    if (!updated) throw new NotFoundException('User not found');

    return this.toResponse(updated);
  }

  async getPublicProfile(id: string, viewer: Viewer | null) {
    const user = await this.findOne(id);
    const base = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: this.s3.publicUrl(user.avatarKey),
    };

    const isOwner = this.isOwner(user, viewer);
    if (!isOwner && !user.isProfilePublic) {
      return { ...base, isPrivate: true };
    }

    const canViewCv = await this.canViewCv(user, viewer);

    return {
      ...base,
      ...(isOwner || user.isEmailPublic ? { email: user.email } : {}),
      ...(isOwner || user.isPhonePublic ? { phone: user.phone } : {}),
      isPrivate: false,
      hasCv: canViewCv && user.cvKey !== '',
    };
  }

  async getCvUrl(id: string, viewer: Viewer) {
    const user = await this.findOne(id);
    const canViewCv = await this.canViewCv(user, viewer);
    if (!canViewCv || !user.cvKey) throw new NotFoundException('CV not found');

    return this.s3.presignedUrl(user.cvKey);
  }

  private isOwner(user: UserDocument, viewer: Viewer | null): boolean {
    return (
      viewer !== null &&
      viewer.accountRole === AuthRole.USER &&
      viewer.accountId === user.id
    );
  }

  private async canViewCv(
    user: UserDocument,
    viewer: Viewer | null,
  ): Promise<boolean> {
    if (this.isOwner(user, viewer)) return true;
    if (viewer?.accountRole !== AuthRole.COMPANY) return false;
    if (!user.isProfilePublic || !user.isCvPublic) return false;

    const company = await this.companiesService.findOne(viewer.accountId);

    return company.approved;
  }

  async findAll({ page, take }: PaginationDto) {
    const [items, total] = await Promise.all([
      this.userModel
        .find()
        .sort({ _id: -1 })
        .skip((page - 1) * take)
        .limit(take),
      this.userModel.countDocuments(),
    ]);

    return { items, total, page, take };
  }

  async findOne(id: string): Promise<UserDocument> {
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');

    return user;
  }

  findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email });
  }

  findByGoogleId(googleId: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ googleId });
  }

  async linkGoogleAccount(user: UserDocument, googleId: string): Promise<void> {
    const update: UpdateQuery<User> = user.isVerified
      ? { $set: { googleId } }
      : {
          $set: { googleId, isVerified: true },
          $unset: {
            password: 1,
            OTPCode: 1,
            OTPCodeExpirationDate: 1,
            OTPPurpose: 1,
            OTPAttempts: 1,
          },
        };

    await this.userModel.updateOne({ _id: user._id }, update);
  }

  findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email }).select('+password');
  }

  findByEmailWithVerificationCode(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email })
      .select('+OTPCode +OTPCodeExpirationDate +OTPPurpose');
  }

  async isPasswordSetupRequired(id: string): Promise<boolean> {
    const hasLogin = await this.userModel.exists({
      _id: id,
      $or: [{ password: { $exists: true } }, { googleId: { $exists: true } }],
    });

    return !hasLogin;
  }

  claimOtpAttempt(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOneAndUpdate(
        { email, ...otpAttemptsLeftFilter },
        { $inc: { OTPAttempts: 1 } },
        { returnDocument: 'after' },
      )
      .select('+OTPCode +OTPCodeExpirationDate +OTPPurpose');
  }

  async setVerificationCode(
    email: string,
    otpHash: string,
    expiresAt: Date,
    purpose: OtpPurpose,
  ): Promise<void> {
    await this.userModel.updateOne(
      { email },
      {
        $set: {
          OTPCode: otpHash,
          OTPCodeExpirationDate: expiresAt,
          OTPPurpose: purpose,
          OTPAttempts: 0,
        },
      },
    );
  }

  async resetPassword(email: string, passwordHash: string): Promise<void> {
    await this.userModel.updateOne(
      { email },
      {
        $set: { password: passwordHash, isVerified: true },
        $unset: {
          OTPCode: 1,
          OTPCodeExpirationDate: 1,
          OTPPurpose: 1,
          OTPAttempts: 1,
        },
      },
    );
  }

  async markEmailVerified(email: string): Promise<void> {
    await this.userModel.updateOne(
      { email },
      {
        $set: { isVerified: true },
        $unset: {
          OTPCode: 1,
          OTPCodeExpirationDate: 1,
          OTPPurpose: 1,
          OTPAttempts: 1,
        },
      },
    );
  }

  claimEmailChangeAttempt(id: string): Promise<UserDocument | null> {
    return this.userModel
      .findOneAndUpdate(
        { _id: id, ...otpAttemptsLeftFilter },
        { $inc: { OTPAttempts: 1 } },
        { returnDocument: 'after' },
      )
      .select('+OTPCode +OTPCodeExpirationDate +OTPPurpose +pendingEmail');
  }

  findForEmailChange(id: string): Promise<UserDocument | null> {
    return this.userModel
      .findById(id)
      .select('+OTPCode +OTPCodeExpirationDate +OTPPurpose +pendingEmail');
  }

  async startEmailChange(
    id: string,
    pendingEmail: string,
    otpHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.userModel.updateOne(
      { _id: id },
      {
        $set: {
          pendingEmail,
          OTPCode: otpHash,
          OTPCodeExpirationDate: expiresAt,
          OTPPurpose: OtpPurpose.CURRENT_EMAIL_CHANGE,
          OTPAttempts: 0,
        },
      },
    );
  }

  async setEmailChangeCode(
    id: string,
    otpHash: string,
    expiresAt: Date,
    purpose: OtpPurpose,
  ): Promise<void> {
    await this.userModel.updateOne(
      { _id: id },
      {
        $set: {
          OTPCode: otpHash,
          OTPCodeExpirationDate: expiresAt,
          OTPPurpose: purpose,
          OTPAttempts: 0,
        },
      },
    );
  }

  async completeEmailChange(id: string, email: string): Promise<void> {
    await this.userModel.updateOne(
      { _id: id },
      {
        $set: { email },
        $unset: {
          pendingEmail: 1,
          OTPCode: 1,
          OTPCodeExpirationDate: 1,
          OTPPurpose: 1,
          OTPAttempts: 1,
        },
      },
    );
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
  ): Promise<UserDocument> {
    const { firstName, lastName, birthDate, phone } = updateUserDto;
    const changes: Partial<
      Pick<User, 'firstName' | 'lastName' | 'birthDate' | 'phone'>
    > = {};

    if (firstName) changes.firstName = firstName;
    if (lastName) changes.lastName = lastName;
    if (birthDate) changes.birthDate = birthDate;
    if (typeof phone === 'string') changes.phone = phone;

    const user = await this.userModel.findByIdAndUpdate(id, changes, {
      new: true,
    });
    if (!user) throw new NotFoundException('User not found');

    return user;
  }

  async changePassword(
    id: string,
    { currentPassword, newPassword }: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.userModel.findById(id).select('+password');
    if (!user) throw new NotFoundException('User not found');

    const password = await hashChangedPassword(
      user.password,
      currentPassword,
      newPassword,
    );
    await this.userModel.updateOne({ _id: id }, { $set: { password } });
  }

  async remove(id: string): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndDelete(id);
    if (!user) throw new NotFoundException('User not found');

    await this.emailClaims.releaseAll(id);
    await Promise.all([
      this.s3.deleteQuietly(user.avatarKey),
      this.s3.deleteQuietly(user.cvKey),
    ]);

    return user;
  }
}
