import {
  ForbiddenException,
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
import { OtpPurpose } from '../shared/types/otp-purpose.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { User, UserDocument } from './schema/user.schema.js';

@Injectable()
export class UsersService {
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

  async getCvUrl(id: string, accountId: string, accountRole: AuthRole) {
    const user = await this.findOne(id);
    await this.assertCanViewCv(user, accountId, accountRole);
    if (!user.cvKey) throw new NotFoundException('CV not found');

    return this.s3.presignedUrl(user.cvKey);
  }

  private async assertCanViewCv(
    user: UserDocument,
    accountId: string,
    accountRole: AuthRole,
  ): Promise<void> {
    if (accountRole === AuthRole.USER && accountId === user.id) return;

    if (accountRole === AuthRole.COMPANY && user.isCvPublic) {
      const company = await this.companiesService.findOne(accountId);
      if (company.approved) return;
    }

    throw new ForbiddenException('No permission');
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
        },
      },
    );
  }

  async resetPassword(email: string, passwordHash: string): Promise<void> {
    await this.userModel.updateOne(
      { email },
      {
        $set: { password: passwordHash },
        $unset: { OTPCode: 1, OTPCodeExpirationDate: 1, OTPPurpose: 1 },
      },
    );
  }

  async markEmailVerified(email: string): Promise<void> {
    await this.userModel.updateOne(
      { email },
      {
        $set: { isVerified: true },
        $unset: { OTPCode: 1, OTPCodeExpirationDate: 1, OTPPurpose: 1 },
      },
    );
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
