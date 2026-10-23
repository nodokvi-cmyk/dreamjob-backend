import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { PaginationDto } from '../shared/dto/pagination.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { OtpPurpose, User, UserDocument } from './schema/user.schema.js';

const PASSWORD_SALT_ROUNDS = 10;

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

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
  ): Promise<UserDocument> {
    const { firstName, lastName, birthDate, password } = updateUserDto;
    const changes: Partial<
      Pick<User, 'firstName' | 'lastName' | 'birthDate' | 'password'>
    > = {};

    if (firstName) changes.firstName = firstName;
    if (lastName) changes.lastName = lastName;
    if (birthDate) changes.birthDate = birthDate;
    if (password) {
      changes.password = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
    }

    const user = await this.userModel.findByIdAndUpdate(id, changes, {
      new: true,
    });
    if (!user) throw new NotFoundException('User not found');

    return user;
  }

  async remove(id: string): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndDelete(id);
    if (!user) throw new NotFoundException('User not found');

    return user;
  }
}
