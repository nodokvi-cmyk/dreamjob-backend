import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { hashChangedPassword } from '../shared/crypto/change-password.js';
import { ChangePasswordDto } from '../shared/dto/change-password.dto.js';
import { PaginationDto } from '../shared/dto/pagination.dto.js';
import { OtpPurpose } from '../shared/types/otp-purpose.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { User, UserDocument } from './schema/user.schema.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

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

    return user;
  }
}
