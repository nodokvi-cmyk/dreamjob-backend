import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CompaniesService } from '../companies/companies.service.js';
import { CreateCompanyDto } from '../companies/dto/create-company.dto.js';
import {
  Company,
  CompanyDocument,
} from '../companies/schema/company.schema.js';
import { EmailClaimsService } from '../email-claims/email-claims.service.js';
import { EmailSenderService } from '../email-sender/email-sender.service.js';
import {
  hashOtp,
  isOtpValid,
  type OtpHolder,
} from '../shared/crypto/otp-hash.js';
import { otpCooldownSecondsLeft } from '../shared/crypto/otp-cooldown.js';
import { hashPassword, isPasswordMatch } from '../shared/crypto/password.js';
import {
  // emailNotVerifiedSignInError,
  emailNotVerifiedSignUpError,
} from '../shared/errors/email-not-verified.js';
import { withEmailConflict } from '../shared/mongo/with-email-conflict.js';
import { AuthRole, authRoleByUserRole } from '../shared/types/auth-role.js';
import type { JwtPayload } from '../shared/types/jwt-payload.js';
import { OtpPurpose } from '../shared/types/otp-purpose.js';
import { CreateUserDto } from '../users/dto/create-user.dto.js';
import { User, UserDocument } from '../users/schema/user.schema.js';
import { UsersService } from '../users/users.service.js';
import { EmailDto } from './dto/email.dto.js';
import { GoogleSignInDto } from './dto/google-sign-in.dto.js';
import {
  GoogleIdentity,
  GoogleTokenVerifier,
} from './google-token-verifier.service.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { SignInDto } from './dto/sign-in.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';

const SIGN_UP_MESSAGE = 'Verification code sent to your email';
const RESEND_MESSAGE =
  'If the account exists and is not verified, a new code was sent to its email';

const FORGOT_PASSWORD_MESSAGE =
  'If the account exists, a password reset code was sent to its email';
const RESET_PASSWORD_MESSAGE = 'Password was reset, you can sign in now';

type SaveCode = (
  otpHash: string,
  expiresAt: Date,
  purpose: OtpPurpose,
) => Promise<void>;

type VerifiableAccount = Pick<
  User,
  'isVerified' | 'OTPCode' | 'OTPCodeExpirationDate' | 'OTPPurpose'
>;

type SignableAccount = Pick<User, 'isVerified' | 'password'>;

type SignUpCredentials = Pick<
  User,
  'OTPCode' | 'OTPCodeExpirationDate' | 'OTPPurpose'
>;

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Company.name) private readonly companyModel: Model<Company>,
    private readonly usersService: UsersService,
    private readonly companiesService: CompaniesService,
    private readonly emailClaims: EmailClaimsService,
    private readonly emailSender: EmailSenderService,
    private readonly googleTokenVerifier: GoogleTokenVerifier,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  signUpUser(createUserDto: CreateUserDto): Promise<{ message: string }> {
    const { firstName, lastName, email, birthDate, phone } = createUserDto;

    return this.signUp(
      email,
      (address) => this.usersService.findByEmail(address),
      (_id, credentials) =>
        this.userModel.create({
          _id,
          firstName,
          lastName,
          email,
          birthDate,
          phone,
          ...credentials,
        }),
    );
  }

  signUpCompany(
    createCompanyDto: CreateCompanyDto,
  ): Promise<{ message: string }> {
    const {
      companyName,
      email,
      phone,
      location,
      description,
      website,
      operatingCities,
      director,
    } = createCompanyDto;

    return this.signUp(
      email,
      (address) => this.companiesService.findByEmail(address),
      (_id, credentials) =>
        this.companyModel.create({
          _id,
          companyName,
          email,
          phone,
          location,
          description,
          website,
          operatingCities,
          director: director ?? undefined,
          ...credentials,
        }),
    );
  }

  async signInUserWithGoogle({
    idToken,
  }: GoogleSignInDto): Promise<{ token: string }> {
    const identity = await this.googleTokenVerifier.verify(idToken);
    const user =
      (await this.usersService.findByGoogleId(identity.googleId)) ??
      (await this.linkOrCreateGoogleUser(identity));

    return { token: await this.signUserToken(user) };
  }

  async signInCompanyWithGoogle({
    idToken,
  }: GoogleSignInDto): Promise<{ token: string }> {
    const identity = await this.googleTokenVerifier.verify(idToken);
    const company =
      (await this.companiesService.findByGoogleId(identity.googleId)) ??
      (await this.linkOrCreateGoogleCompany(identity));

    return { token: await this.signCompanyToken(company) };
  }

  async verifyUserEmail({
    email,
    code,
  }: VerifyEmailDto): Promise<{ token: string }> {
    const user = await this.usersService.claimOtpAttempt(email);
    if (!user || !this.isVerificationCodeValid(user, code)) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    await this.usersService.markEmailVerified(email);

    return { token: await this.signUserToken(user) };
  }

  async verifyCompanyEmail({
    email,
    code,
  }: VerifyEmailDto): Promise<{ token: string }> {
    const company = await this.companiesService.claimOtpAttempt(email);
    if (!company || !this.isVerificationCodeValid(company, code)) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    await this.companiesService.markEmailVerified(email);

    return { token: await this.signCompanyToken(company) };
  }

  async signInUser({ email, password }: SignInDto): Promise<{ token: string }> {
    const user = await this.verifyCredentials(
      await this.usersService.findByEmailWithPassword(email),
      password,
    );

    return { token: await this.signUserToken(user) };
  }

  async signInCompany({
    email,
    password,
  }: SignInDto): Promise<{ token: string }> {
    const company = await this.verifyCredentials(
      await this.companiesService.findByEmailWithPassword(email),
      password,
    );

    return { token: await this.signCompanyToken(company) };
  }

  async resendUserCode({ email }: EmailDto): Promise<{ message: string }> {
    const user = await this.usersService.findByEmailWithVerificationCode(email);

    if (user && !user.isVerified && !otpCooldownSecondsLeft(user)) {
      await this.issueVerificationCode(email, (otpHash, expiresAt, purpose) =>
        this.usersService.setVerificationCode(
          email,
          otpHash,
          expiresAt,
          purpose,
        ),
      );
    }

    return { message: RESEND_MESSAGE };
  }

  async resendCompanyCode({ email }: EmailDto): Promise<{ message: string }> {
    const company =
      await this.companiesService.findByEmailWithVerificationCode(email);

    if (company && !company.isVerified && !otpCooldownSecondsLeft(company)) {
      await this.issueVerificationCode(email, (otpHash, expiresAt, purpose) =>
        this.companiesService.setVerificationCode(
          email,
          otpHash,
          expiresAt,
          purpose,
        ),
      );
    }

    return { message: RESEND_MESSAGE };
  }

  async forgotUserPassword({ email }: EmailDto): Promise<{ message: string }> {
    const user = await this.usersService.findByEmailWithVerificationCode(email);

    if (user && !otpCooldownSecondsLeft(user)) {
      await this.issuePasswordResetCode(email, (otpHash, expiresAt, purpose) =>
        this.usersService.setVerificationCode(
          email,
          otpHash,
          expiresAt,
          purpose,
        ),
      );
    }

    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  async forgotCompanyPassword({
    email,
  }: EmailDto): Promise<{ message: string }> {
    const company =
      await this.companiesService.findByEmailWithVerificationCode(email);

    if (company && !otpCooldownSecondsLeft(company)) {
      await this.issuePasswordResetCode(email, (otpHash, expiresAt, purpose) =>
        this.companiesService.setVerificationCode(
          email,
          otpHash,
          expiresAt,
          purpose,
        ),
      );
    }

    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  async resetUserPassword(
    resetPasswordDto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    const { email } = resetPasswordDto;
    const passwordHash = await this.hashResetPassword(
      await this.usersService.claimOtpAttempt(email),
      resetPasswordDto,
    );
    await this.usersService.resetPassword(email, passwordHash);

    return { message: RESET_PASSWORD_MESSAGE };
  }

  async resetCompanyPassword(
    resetPasswordDto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    const { email } = resetPasswordDto;
    const passwordHash = await this.hashResetPassword(
      await this.companiesService.claimOtpAttempt(email),
      resetPasswordDto,
    );
    await this.companiesService.resetPassword(email, passwordHash);

    return { message: RESET_PASSWORD_MESSAGE };
  }

  async getCurrentAccount(accountId: string, accountRole: AuthRole) {
    if (accountRole === AuthRole.COMPANY) {
      const [company, passwordSetupRequired] = await Promise.all([
        this.companiesService.findOne(accountId),
        this.companiesService.isPasswordSetupRequired(accountId),
      ]);

      return {
        ...this.companiesService.toResponse(company),
        passwordSetupRequired,
      };
    }

    const [user, passwordSetupRequired] = await Promise.all([
      this.usersService.findOne(accountId),
      this.usersService.isPasswordSetupRequired(accountId),
    ]);

    return { ...this.usersService.toResponse(user), passwordSetupRequired };
  }

  private async signUp(
    email: string,
    findSameTypeAccount: (
      email: string,
    ) => Promise<Pick<User, 'isVerified'> | null>,
    create: (
      accountId: Types.ObjectId,
      credentials: SignUpCredentials,
    ) => Promise<unknown>,
  ): Promise<{ message: string }> {
    const existing = await findSameTypeAccount(email);
    if (existing && !existing.isVerified) {
      throw emailNotVerifiedSignUpError();
    }

    const accountId = new Types.ObjectId();
    await this.emailClaims.claim(email, accountId);

    try {
      await this.assertNoAccountWithEmail(email);
      const credentials = await this.prepareSignUp(email);
      await withEmailConflict(() => create(accountId, credentials));
    } catch (error: unknown) {
      await this.emailClaims.release(email, accountId);
      throw error;
    }
    await this.emailClaims.confirm(email, accountId);

    return { message: SIGN_UP_MESSAGE };
  }

  private async linkOrCreateGoogleUser(
    identity: GoogleIdentity,
  ): Promise<UserDocument> {
    const existing = await this.usersService.findByEmail(identity.email);
    if (!existing) return this.createGoogleUser(identity);

    if (existing.googleId) {
      throw new UnauthorizedException('Google sign-in failed');
    }

    await this.usersService.linkGoogleAccount(existing, identity.googleId);

    return existing;
  }

  private async createGoogleUser({
    googleId,
    email,
    firstName,
    lastName,
  }: GoogleIdentity): Promise<UserDocument> {
    const accountId = new Types.ObjectId();
    await this.emailClaims.claim(email, accountId);

    let user: UserDocument;
    try {
      await this.assertNoAccountWithEmail(email);
      user = await this.userModel.create({
        _id: accountId,
        firstName,
        lastName,
        email,
        googleId,
        isVerified: true,
      });
    } catch (error: unknown) {
      await this.emailClaims.release(email, accountId);
      throw error;
    }
    await this.emailClaims.confirm(email, accountId);

    return user;
  }

  private async linkOrCreateGoogleCompany(
    identity: GoogleIdentity,
  ): Promise<CompanyDocument> {
    const existing = await this.companiesService.findByEmail(identity.email);
    if (!existing) return this.createGoogleCompany(identity);

    if (existing.googleId) {
      throw new UnauthorizedException('Google sign-in failed');
    }

    await this.companiesService.linkGoogleAccount(existing, identity.googleId);

    return existing;
  }

  private async createGoogleCompany({
    googleId,
    email,
  }: GoogleIdentity): Promise<CompanyDocument> {
    const accountId = new Types.ObjectId();
    await this.emailClaims.claim(email, accountId);

    let company: CompanyDocument;
    try {
      await this.assertNoAccountWithEmail(email);
      company = await this.companyModel.create({
        _id: accountId,
        email,
        googleId,
        isVerified: true,
      });
    } catch (error: unknown) {
      await this.emailClaims.release(email, accountId);
      throw error;
    }
    await this.emailClaims.confirm(email, accountId);

    return company;
  }

  private async assertNoAccountWithEmail(email: string): Promise<void> {
    const [user, company] = await Promise.all([
      this.usersService.findByEmail(email),
      this.companiesService.findByEmail(email),
    ]);

    if (user || company) {
      throw new ConflictException('Email is already in use');
    }
  }

  private async prepareSignUp(email: string): Promise<SignUpCredentials> {
    const { code, expiresAt } = this.emailSender.createVerificationCode();
    await this.emailSender.sendVerificationCode(email, code);

    return {
      OTPCode: hashOtp(code, this.otpSecret()),
      OTPCodeExpirationDate: expiresAt,
      OTPPurpose: OtpPurpose.EMAIL_VERIFICATION,
    };
  }

  private issueVerificationCode(email: string, save: SaveCode): Promise<void> {
    return this.issueCode(
      email,
      OtpPurpose.EMAIL_VERIFICATION,
      (code) => this.emailSender.sendVerificationCode(email, code),
      save,
    );
  }

  private issuePasswordResetCode(email: string, save: SaveCode): Promise<void> {
    return this.issueCode(
      email,
      OtpPurpose.PASSWORD_RESET,
      (code) => this.emailSender.sendPasswordResetCode(email, code),
      save,
    );
  }

  private async issueCode(
    email: string,
    purpose: OtpPurpose,
    send: (code: string) => Promise<void>,
    save: SaveCode,
  ): Promise<void> {
    const { code, expiresAt } = this.emailSender.createVerificationCode();
    await send(code);
    await save(hashOtp(code, this.otpSecret()), expiresAt, purpose);
  }

  private async hashResetPassword(
    account: OtpHolder | null,
    { code, newPassword }: ResetPasswordDto,
  ): Promise<string> {
    if (
      !account ||
      !isOtpValid(account, code, OtpPurpose.PASSWORD_RESET, this.otpSecret())
    ) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    return hashPassword(newPassword);
  }

  private async verifyCredentials<T extends SignableAccount>(
    account: T | null,
    password: string,
  ): Promise<T> {
    const isPasswordCorrect = account?.password
      ? await isPasswordMatch(password, account.password)
      : false;

    if (!account || !isPasswordCorrect) {
      throw new UnauthorizedException('Email or password is invalid');
    }

    // if (!account.isVerified) {
    //   throw emailNotVerifiedSignInError();
    // }

    return account;
  }

  private isVerificationCodeValid(
    account: VerifiableAccount,
    code: string,
  ): boolean {
    return (
      !account.isVerified &&
      isOtpValid(account, code, OtpPurpose.EMAIL_VERIFICATION, this.otpSecret())
    );
  }

  private signUserToken(user: UserDocument): Promise<string> {
    return this.signToken({
      accountId: user._id.toString(),
      accountRole: authRoleByUserRole[user.role],
    });
  }

  private signCompanyToken(company: CompanyDocument): Promise<string> {
    return this.signToken({
      accountId: company._id.toString(),
      accountRole: AuthRole.COMPANY,
    });
  }

  private signToken(payload: JwtPayload): Promise<string> {
    return this.jwtService.signAsync(payload);
  }

  private otpSecret(): string {
    return this.config.getOrThrow<string>('OTP_SECRET');
  }
}
