import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo } from 'mongoose';
import { EmailSenderService } from '../email-sender/email-sender.service.js';
import { hashOtp, isOtpMatch } from '../shared/crypto/otp-hash.js';
import { hashPassword, isPasswordMatch } from '../shared/crypto/password.js';
import { authRoleByUserRole } from '../shared/types/auth-role.js';
import type { JwtPayload } from '../shared/types/jwt-payload.js';
import { CreateUserDto } from '../users/dto/create-user.dto.js';
import { OtpPurpose, User, UserDocument } from '../users/schema/user.schema.js';
import { UsersService } from '../users/users.service.js';
import { EmailDto } from './dto/email.dto.js';
import { SignInDto } from './dto/sign-in.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';

const DUPLICATE_KEY_CODE = 11000;

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly usersService: UsersService,
    private readonly emailSender: EmailSenderService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async signUp(createUserDto: CreateUserDto): Promise<{ message: string }> {
    const { firstName, lastName, email, birthDate } = createUserDto;

    if (await this.usersService.findByEmail(email)) {
      throw new ConflictException('Email is already in use');
    }

    const password = await hashPassword(createUserDto.password);
    const { code, expiresAt } = this.emailSender.createVerificationCode();
    await this.emailSender.sendVerificationCode(email, code);

    try {
      await this.userModel.create({
        firstName,
        lastName,
        email,
        birthDate,
        password,
        OTPCode: hashOtp(code, this.otpSecret()),
        OTPCodeExpirationDate: expiresAt,
        OTPPurpose: OtpPurpose.EMAIL_VERIFICATION,
      });
    } catch (error: unknown) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException('Email is already in use');
      }
      throw error;
    }

    return { message: 'Verification code sent to your email' };
  }

  async verifyEmail({
    email,
    code,
  }: VerifyEmailDto): Promise<{ token: string }> {
    const user = await this.usersService.findByEmailWithVerificationCode(email);
    if (!user || !this.isVerificationCodeValid(user, code)) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    await this.usersService.markEmailVerified(email);

    return { token: await this.signToken(user) };
  }

  async signIn({ email, password }: SignInDto): Promise<{ token: string }> {
    const user = await this.usersService.findByEmailWithPassword(email);
    const isPasswordCorrect = user?.password
      ? await isPasswordMatch(password, user.password)
      : false;

    if (!user || !isPasswordCorrect) {
      throw new UnauthorizedException('Email or password is invalid');
    }

    if (!user.isVerified) {
      throw new ForbiddenException(
        'Please verify your email before signing in',
      );
    }

    return { token: await this.signToken(user) };
  }

  async resendVerificationCode({
    email,
  }: EmailDto): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(email);

    if (user && !user.isVerified) {
      const { code, expiresAt } = this.emailSender.createVerificationCode();
      await this.usersService.setVerificationCode(
        email,
        hashOtp(code, this.otpSecret()),
        expiresAt,
        OtpPurpose.EMAIL_VERIFICATION,
      );
      await this.emailSender.sendVerificationCode(email, code);
    }

    return {
      message:
        'If the account exists and is not verified, a new code was sent to its email',
    };
  }

  getCurrentUser(accountId: string): Promise<UserDocument> {
    return this.usersService.findOne(accountId);
  }

  private isVerificationCodeValid(user: UserDocument, code: string): boolean {
    const { isVerified, OTPCode, OTPCodeExpirationDate, OTPPurpose } = user;

    return (
      !isVerified &&
      !!OTPCode &&
      !!OTPCodeExpirationDate &&
      OTPPurpose === OtpPurpose.EMAIL_VERIFICATION &&
      OTPCodeExpirationDate.getTime() > Date.now() &&
      isOtpMatch(code, OTPCode, this.otpSecret())
    );
  }

  private signToken(user: UserDocument): Promise<string> {
    const payload: JwtPayload = {
      accountId: user._id.toString(),
      accountRole: authRoleByUserRole[user.role],
    };
    return this.jwtService.signAsync(payload);
  }

  private otpSecret(): string {
    return this.config.getOrThrow<string>('OTP_SECRET');
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      error instanceof mongo.MongoServerError &&
      error.code === DUPLICATE_KEY_CODE
    );
  }
}
