import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, UpdateQuery } from 'mongoose';
import { AwsS3Service } from '../aws-s3/aws-s3.service.js';
import {
  ImageKind,
  PROCESSED_IMAGE_CONTENT_TYPE,
  processImage,
} from '../aws-s3/process-image.js';
import { StoragePrefix } from '../aws-s3/storage-prefix.js';
import { EmailClaimsService } from '../email-claims/email-claims.service.js';
import { hashChangedPassword } from '../shared/crypto/change-password.js';
import { ChangePasswordDto } from '../shared/dto/change-password.dto.js';
import { PaginationDto } from '../shared/dto/pagination.dto.js';
import { OtpPurpose } from '../shared/types/otp-purpose.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import { Company, CompanyDocument } from './schema/company.schema.js';

type CompanyChanges = Partial<
  Pick<
    Company,
    | 'companyName'
    | 'phone'
    | 'location'
    | 'description'
    | 'website'
    | 'operatingCities'
    | 'director'
  >
>;

@Injectable()
export class CompaniesService {
  constructor(
    @InjectModel(Company.name) private readonly companyModel: Model<Company>,
    private readonly emailClaims: EmailClaimsService,
    private readonly s3: AwsS3Service,
  ) {}

  toResponse(company: CompanyDocument) {
    const { logoKey, ...rest } = company.toJSON();

    return { ...rest, logoUrl: this.s3.publicUrl(logoKey) };
  }

  async setLogo(id: string, file: Express.Multer.File) {
    const company = await this.findOne(id);
    const body = await processImage(file.buffer, ImageKind.LOGO);
    const key = this.s3.newKey(StoragePrefix.COMPANY_LOGOS);

    await this.s3.upload(key, body, PROCESSED_IMAGE_CONTENT_TYPE);
    const updated = await this.companyModel.findByIdAndUpdate(
      id,
      { $set: { logoKey: key } },
      { new: true },
    );
    if (!updated) {
      await this.s3.deleteQuietly(key);
      throw new NotFoundException('Company not found');
    }

    await this.s3.deleteQuietly(company.logoKey);

    return this.toResponse(updated);
  }

  async removeLogo(id: string) {
    const company = await this.findOne(id);
    if (!company.logoKey) throw new NotFoundException('Logo not found');

    const updated = await this.companyModel.findByIdAndUpdate(
      id,
      { $set: { logoKey: '' } },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Company not found');

    await this.s3.deleteQuietly(company.logoKey);

    return this.toResponse(updated);
  }

  async findAll({ page, take }: PaginationDto) {
    const [items, total] = await Promise.all([
      this.companyModel
        .find()
        .sort({ _id: -1 })
        .skip((page - 1) * take)
        .limit(take),
      this.companyModel.countDocuments(),
    ]);

    return { items, total, page, take };
  }

  async findOne(id: string): Promise<CompanyDocument> {
    const company = await this.companyModel.findById(id);
    if (!company) throw new NotFoundException('Company not found');

    return company;
  }

  findByEmail(email: string): Promise<CompanyDocument | null> {
    return this.companyModel.findOne({ email });
  }

  findByGoogleId(googleId: string): Promise<CompanyDocument | null> {
    return this.companyModel.findOne({ googleId });
  }

  async linkGoogleAccount(
    company: CompanyDocument,
    googleId: string,
  ): Promise<void> {
    const update: UpdateQuery<Company> = company.isVerified
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

    await this.companyModel.updateOne({ _id: company._id }, update);
  }

  findByEmailWithPassword(email: string): Promise<CompanyDocument | null> {
    return this.companyModel.findOne({ email }).select('+password');
  }

  findByEmailWithVerificationCode(
    email: string,
  ): Promise<CompanyDocument | null> {
    return this.companyModel
      .findOne({ email })
      .select('+OTPCode +OTPCodeExpirationDate +OTPPurpose');
  }

  async setVerificationCode(
    email: string,
    otpHash: string,
    expiresAt: Date,
    purpose: OtpPurpose,
  ): Promise<void> {
    await this.companyModel.updateOne(
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
    await this.companyModel.updateOne(
      { email },
      {
        $set: { isVerified: true },
        $unset: { OTPCode: 1, OTPCodeExpirationDate: 1, OTPPurpose: 1 },
      },
    );
  }

  findForEmailChange(id: string): Promise<CompanyDocument | null> {
    return this.companyModel
      .findById(id)
      .select('+OTPCode +OTPCodeExpirationDate +OTPPurpose +pendingEmail');
  }

  async startEmailChange(
    id: string,
    pendingEmail: string,
    otpHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.companyModel.updateOne(
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
    await this.companyModel.updateOne(
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
    await this.companyModel.updateOne(
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
    updateCompanyDto: UpdateCompanyDto,
  ): Promise<CompanyDocument> {
    const {
      companyName,
      phone,
      location,
      description,
      website,
      operatingCities,
      director,
    } = updateCompanyDto;
    const changes: CompanyChanges = {};

    if (companyName) changes.companyName = companyName;
    if (typeof phone === 'string') changes.phone = phone;
    if (typeof location === 'string') changes.location = location;
    if (description) changes.description = description;
    if (typeof website === 'string') changes.website = website;
    if (operatingCities) changes.operatingCities = operatingCities;
    if (director) changes.director = director;

    const update: UpdateQuery<Company> = {};
    if (Object.keys(changes).length > 0) update.$set = changes;
    if (director === null) update.$unset = { director: 1 };

    const company = await this.companyModel.findByIdAndUpdate(id, update, {
      new: true,
    });
    if (!company) throw new NotFoundException('Company not found');

    return company;
  }

  async changePassword(
    id: string,
    { currentPassword, newPassword }: ChangePasswordDto,
  ): Promise<void> {
    const company = await this.companyModel.findById(id).select('+password');
    if (!company) throw new NotFoundException('Company not found');

    const password = await hashChangedPassword(
      company.password,
      currentPassword,
      newPassword,
    );
    await this.companyModel.updateOne({ _id: id }, { $set: { password } });
  }

  async approve(id: string): Promise<CompanyDocument> {
    const existing = await this.findOne(id);
    if (!existing.isProfileComplete) {
      throw new BadRequestException(
        'Company profile is incomplete: companyName and description are required',
      );
    }

    const company = await this.companyModel.findByIdAndUpdate(
      id,
      { approved: true },
      { new: true },
    );
    if (!company) throw new NotFoundException('Company not found');

    return company;
  }

  async remove(id: string): Promise<CompanyDocument> {
    const company = await this.companyModel.findByIdAndDelete(id);
    if (!company) throw new NotFoundException('Company not found');

    await this.emailClaims.releaseAll(id);
    await this.s3.deleteQuietly(company.logoKey);

    return company;
  }
}
