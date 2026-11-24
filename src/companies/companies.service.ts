import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Model,
  PipelineStage,
  QueryFilter,
  Types,
  UpdateQuery,
} from 'mongoose';
import { VacancyStatus } from '../vacancies/schema/vacancy.schema.js';
import {
  searchWords,
  wordStartPattern,
} from '../shared/mongo/search-patterns.js';
import { excerpt } from '../shared/text/excerpt.js';
import { CompanyFilterDto } from './dto/company-filter.dto.js';
import type { CompanySort } from './dto/company-filter.dto.js';
import { AwsS3Service } from '../aws-s3/aws-s3.service.js';
import {
  ImageKind,
  PROCESSED_IMAGE_CONTENT_TYPE,
  processImage,
} from '../aws-s3/process-image.js';
import { StoragePrefix } from '../aws-s3/storage-prefix.js';
import { EmailClaimsService } from '../email-claims/email-claims.service.js';
import { ApplicationsService } from '../applications/applications.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationType } from '../notifications/schema/notification.schema.js';
import { PaymentService } from '../payment/payment.service.js';
import { hashChangedPassword } from '../shared/crypto/change-password.js';
import { ChangePasswordDto } from '../shared/dto/change-password.dto.js';
import { PaginationDto } from '../shared/dto/pagination.dto.js';
import { AuthRole } from '../shared/types/auth-role.js';
import { BillingPlan } from '../shared/types/billing-plan.js';
import type { EmailChangeStore } from '../shared/types/email-change-store.js';
import { otpAttemptsLeftFilter } from '../shared/crypto/otp-attempts.js';
import { OtpPurpose } from '../shared/types/otp-purpose.js';
import {
  MIN_RANKED_RATINGS,
  SHOWN_RATING_EXPRESSION,
  ratingOf,
} from '../ratings/rating-value.js';
import { RatingsService } from '../ratings/ratings.service.js';
import type { Viewer } from '../shared/types/viewer.js';
import { VacanciesService } from '../vacancies/vacancies.service.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import { Company, CompanyDocument } from './schema/company.schema.js';

type PublicCompanyRow = Pick<
  Company,
  | 'companyName'
  | 'description'
  | 'location'
  | 'operatingCities'
  | 'logoKey'
  | 'ratingAverage'
  | 'ratingCount'
> & { _id: Types.ObjectId; openVacancies: number };

type TopRatedRow = Pick<
  Company,
  'companyName' | 'logoKey' | 'ratingAverage' | 'ratingCount'
> & { _id: Types.ObjectId };

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
export class CompaniesService implements EmailChangeStore {
  constructor(
    @InjectModel(Company.name) private readonly companyModel: Model<Company>,
    private readonly emailClaims: EmailClaimsService,
    private readonly s3: AwsS3Service,
    private readonly vacancies: VacanciesService,
    private readonly notifications: NotificationsService,
    private readonly applications: ApplicationsService,
    private readonly payment: PaymentService,
    private readonly ratings: RatingsService,
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

  async isApproved(id: string): Promise<boolean> {
    return (
      (await this.companyModel.exists({ _id: id, approved: true })) !== null
    );
  }

  async listPublic({ page, take, q, location, sort }: CompanyFilterDto) {
    const filter: QueryFilter<Company>[] = [{ approved: true }];
    for (const word of searchWords(q ?? '', 5)) {
      filter.push({
        companyName: { $regex: wordStartPattern(word), $options: 'i' },
      });
    }
    if (location) {
      const pattern = { $regex: wordStartPattern(location), $options: 'i' };
      filter.push({
        $or: [{ location: pattern }, { operatingCities: pattern }],
      });
    }
    const match = { $and: filter };

    const countOpen: PipelineStage[] = [
      {
        $lookup: {
          from: this.vacancies.collectionName,
          localField: '_id',
          foreignField: 'company',
          pipeline: [
            {
              $match: {
                status: VacancyStatus.PUBLISHED,
                deadline: { $gt: new Date() },
              },
            },
            { $count: 'total' },
          ],
          as: 'open',
        },
      },
      {
        $addFields: {
          openVacancies: {
            $ifNull: [{ $arrayElemAt: ['$open.total', 0] }, 0],
          },
        },
      },
    ];
    const pageStages: PipelineStage[] = [
      { $skip: (page - 1) * take },
      { $limit: take },
    ];
    const stages = this.publicSortStages(sort, countOpen, pageStages);

    const [rows, total] = await Promise.all([
      this.companyModel
        .aggregate<PublicCompanyRow>([
          { $match: match },
          ...stages,
          {
            $project: {
              companyName: 1,
              description: 1,
              location: 1,
              operatingCities: 1,
              logoKey: 1,
              ratingAverage: 1,
              ratingCount: 1,
              openVacancies: 1,
            },
          },
        ])
        .collation({ locale: 'en' }),
      this.companyModel.countDocuments(match),
    ]);

    return {
      items: rows.map((row) => ({
        id: row._id.toString(),
        companyName: row.companyName,
        logoUrl: this.s3.publicUrl(row.logoKey),
        excerpt: excerpt(row.description ?? ''),
        location: row.location ?? '',
        operatingCities: row.operatingCities ?? [],
        openVacancies: row.openVacancies,
        rating: ratingOf(row.ratingAverage, row.ratingCount),
      })),
      total,
      page,
      take,
    };
  }

  private publicSortStages(
    sort: CompanySort | undefined,
    countOpen: PipelineStage[],
    pageStages: PipelineStage[],
  ): PipelineStage[] {
    switch (sort) {
      case 'newest':
        return [{ $sort: { _id: -1 } }, ...pageStages, ...countOpen];
      case 'oldest':
        return [{ $sort: { _id: 1 } }, ...pageStages, ...countOpen];
      case 'rating':
        return [
          {
            $addFields: {
              ratingTier: {
                $cond: [
                  {
                    $gte: [
                      { $ifNull: ['$ratingCount', 0] },
                      MIN_RANKED_RATINGS,
                    ],
                  },
                  2,
                  {
                    $cond: [
                      { $gte: [{ $ifNull: ['$ratingCount', 0] }, 1] },
                      1,
                      0,
                    ],
                  },
                ],
              },
              shownRating: SHOWN_RATING_EXPRESSION,
            },
          },
          {
            $sort: {
              ratingTier: -1,
              shownRating: -1,
              ratingCount: -1,
              _id: 1,
            },
          },
          ...pageStages,
          ...countOpen,
        ];
      case 'fewest':
        return [
          ...countOpen,
          { $sort: { openVacancies: 1, companyName: 1, _id: 1 } },
          ...pageStages,
        ];
      default:
        return [
          ...countOpen,
          { $sort: { openVacancies: -1, companyName: 1, _id: 1 } },
          ...pageStages,
        ];
    }
  }

  async listTopRated() {
    const companies = await this.companyModel.aggregate<TopRatedRow>([
      {
        $match: {
          approved: true,
          ratingCount: { $gte: MIN_RANKED_RATINGS },
        },
      },
      { $addFields: { shownRating: SHOWN_RATING_EXPRESSION } },
      { $sort: { shownRating: -1, ratingCount: -1, _id: 1 } },
      { $limit: 5 },
      {
        $project: {
          companyName: 1,
          logoKey: 1,
          ratingAverage: 1,
          ratingCount: 1,
        },
      },
    ]);

    return {
      items: companies.map((company) => ({
        id: company._id.toString(),
        companyName: company.companyName,
        logoUrl: this.s3.publicUrl(company.logoKey),
        rating: ratingOf(company.ratingAverage, company.ratingCount),
      })),
    };
  }

  async getPublicProfile(id: string, viewer: Viewer | null) {
    const [company, openVacancies, myRating] = await Promise.all([
      this.companyModel.findOne({ _id: id, approved: true }),
      this.vacancies.openCount(id),
      viewer?.accountRole === AuthRole.USER
        ? this.ratings.findMine(id, viewer.accountId)
        : null,
    ]);
    if (!company) throw new NotFoundException('Company not found');

    return {
      id: company.id,
      openVacancies,
      companyName: company.companyName,
      description: company.description,
      website: company.website,
      location: company.location,
      operatingCities: company.operatingCities,
      logoUrl: this.s3.publicUrl(company.logoKey),
      email: company.email,
      phone: company.phone,
      director: company.director ?? null,
      rating: ratingOf(company.ratingAverage, company.ratingCount),
      ratingCount: company.ratingCount,
      myRating,
    };
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
  ): Promise<boolean> {
    const update: UpdateQuery<Company> = company.isVerified
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

    const { matchedCount } = await this.companyModel.updateOne(
      { _id: company._id },
      update,
    );
    return matchedCount > 0;
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

  async isPasswordSetupRequired(id: string): Promise<boolean> {
    const hasLogin = await this.companyModel.exists({
      _id: id,
      $or: [{ password: { $exists: true } }, { googleId: { $exists: true } }],
    });

    return !hasLogin;
  }

  claimOtpAttempt(email: string): Promise<CompanyDocument | null> {
    return this.companyModel
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
    await this.companyModel.updateOne(
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

  async resetPassword(email: string, passwordHash: string): Promise<boolean> {
    const { matchedCount } = await this.companyModel.updateOne(
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
    return matchedCount > 0;
  }

  async markEmailVerified(email: string): Promise<boolean> {
    const { matchedCount } = await this.companyModel.updateOne(
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
    return matchedCount > 0;
  }

  claimEmailChangeAttempt(id: string): Promise<CompanyDocument | null> {
    return this.companyModel
      .findOneAndUpdate(
        { _id: id, ...otpAttemptsLeftFilter },
        { $inc: { OTPAttempts: 1 } },
        { returnDocument: 'after' },
      )
      .select('+OTPCode +OTPCodeExpirationDate +OTPPurpose +pendingEmail');
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
    await this.companyModel.updateOne(
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
    await this.companyModel.updateOne(
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
    const { matchedCount } = await this.companyModel.updateOne(
      { _id: id, password: company.password ?? { $exists: false } },
      { $set: { password } },
    );
    if (matchedCount === 0) {
      if (!(await this.companyModel.exists({ _id: id }))) {
        throw new NotFoundException('Company not found');
      }
      throw new ConflictException('Password changed, try again');
    }
  }

  async chooseFreePlan(id: string): Promise<CompanyDocument> {
    const company = await this.companyModel.findOneAndUpdate(
      { _id: id, plan: { $exists: false } },
      { $set: { plan: BillingPlan.PAY_AS_YOU_PUBLISH } },
      { new: true },
    );
    if (company) return company;

    await this.findOne(id);
    throw new BadRequestException('A plan is already chosen');
  }

  async approve(id: string): Promise<CompanyDocument> {
    const existing = await this.findOne(id);
    if (!existing.isVerified) {
      throw new BadRequestException('Company email is not verified');
    }
    if (!existing.isProfileComplete) {
      throw new BadRequestException(
        'Company profile is incomplete: companyName, description and a plan are required',
      );
    }

    const company = await this.companyModel.findOneAndUpdate(
      { _id: id, approved: { $ne: true } },
      { approved: true },
      { new: true },
    );
    if (!company) return this.findOne(id);

    await this.notifications.notify(id, AuthRole.COMPANY, {
      type: NotificationType.COMPANY_APPROVED,
      data: { companyName: company.companyName },
    });

    return company;
  }

  async revoke(id: string): Promise<CompanyDocument> {
    const company = await this.companyModel.findOneAndUpdate(
      { _id: id, approved: true },
      { approved: false },
      { new: true },
    );
    if (!company) return this.findOne(id);

    await this.notifications.notify(id, AuthRole.COMPANY, {
      type: NotificationType.COMPANY_REVOKED,
      data: { companyName: company.companyName },
    });
    await this.applications.notifyCompanyRevoked(id, company.companyName);

    return company;
  }

  async remove(id: string): Promise<CompanyDocument> {
    const billing = await this.companyModel
      .findById(id)
      .select('+stripeCustomerId')
      .lean<Pick<Company, 'stripeCustomerId'>>();
    if (!billing) throw new NotFoundException('Company not found');
    await this.payment.deleteCustomer(billing.stripeCustomerId);

    const company = await this.companyModel.findByIdAndDelete(id);
    if (!company) throw new NotFoundException('Company not found');

    await this.finishRemoval(id);
    await this.s3.deleteQuietly(company.logoKey);

    return company;
  }

  async finishRemoval(id: string): Promise<void> {
    await this.vacancies.removeAllByCompany(id);
    await this.emailClaims.releaseAll(id);
    await this.notifications.removeForRecipient(id, AuthRole.COMPANY);
    await this.ratings.removeForCompany(id);
  }
}
