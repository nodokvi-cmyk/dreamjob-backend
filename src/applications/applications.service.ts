import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { assertPdf, PDF_CONTENT_TYPE } from '../aws-s3/assert-pdf.js';
import { AwsS3Service } from '../aws-s3/aws-s3.service.js';
import { StoragePrefix } from '../aws-s3/storage-prefix.js';
import type { ApplicationFiles } from '../aws-s3/upload-file.js';
import { Company } from '../companies/schema/company.schema.js';
import { isDuplicateKeyError } from '../shared/mongo/is-duplicate-key-error.js';
import { User } from '../users/schema/user.schema.js';
import {
  Vacancy,
  VacancyRecord,
  VacancyStatus,
} from '../vacancies/schema/vacancy.schema.js';
import { ApplyDto } from './dto/apply.dto.js';
import {
  Application,
  ApplicationRecord,
  ApplicationStatus,
  ENDED_APPLICATION_STATUSES,
  MAX_APPLICATION_SUBMISSIONS,
  PreviousOutcome,
  WITHDRAWABLE_APPLICATION_STATUSES,
} from './schema/application.schema.js';

type StoredFiles = Partial<Pick<Application, 'cvKey' | 'coverLetterKey'>>;

type OptionalFields = Partial<
  Pick<Application, 'message' | 'cvKey' | 'coverLetterKey'>
>;

type ApplicationKeys = Pick<ApplicationRecord, 'cvKey' | 'coverLetterKey'>;

const FILE_KEYS_PROJECTION = 'cvKey coverLetterKey';

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    @InjectModel(Application.name)
    private readonly applicationModel: Model<Application>,
    @InjectModel(Vacancy.name) private readonly vacancyModel: Model<Vacancy>,
    @InjectModel(Company.name) private readonly companyModel: Model<Company>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly s3: AwsS3Service,
  ) {}

  toResponse(application: ApplicationRecord) {
    return {
      id: application._id.toString(),
      vacancy: application.vacancy.toString(),
      status: application.status,
      message: application.message ?? '',
      hasCv: Boolean(application.cvKey),
      hasCoverLetter: Boolean(application.coverLetterKey),
      submissions: application.submissions,
      locked: application.locked,
      previousOutcome: application.previousOutcome ?? null,
      appliedAt: application.appliedAt,
      firstAppliedAt: application.firstAppliedAt,
    };
  }

  async apply(
    vacancyId: string,
    userId: string,
    dto: ApplyDto,
    files: ApplicationFiles | undefined,
  ) {
    const cvFile = files?.cv?.[0];
    const coverLetterFile = files?.coverLetter?.[0];
    const useProfileCv = dto.useProfileCv === true;

    if (useProfileCv && cvFile) {
      throw new BadRequestException(
        'Choose either your profile CV or a new CV file, not both',
      );
    }
    if (cvFile) assertPdf(cvFile.buffer);
    if (coverLetterFile) assertPdf(coverLetterFile.buffer);

    const user = await this.userModel
      .findById(userId)
      .select('cvKey')
      .lean<Pick<User, 'cvKey'>>();
    if (!user) throw new NotFoundException('User not found');
    if (useProfileCv && !user.cvKey) {
      throw new BadRequestException('You have no profile CV');
    }

    await this.assertOpenForApplications(vacancyId);

    const existing = await this.applicationModel
      .findOne({ user: userId, vacancy: vacancyId })
      .lean<ApplicationRecord>();
    if (existing && !this.isReapplyAllowed(existing)) {
      throw new ConflictException(this.conflictMessage(existing));
    }

    const stored = await this.storeFiles(
      useProfileCv ? user.cvKey : undefined,
      cvFile,
      coverLetterFile,
    );
    const fields: OptionalFields = {
      message: dto.message || undefined,
      ...stored,
    };

    const keepPrevious = dto.keepPrevious === true;

    let application: ApplicationRecord;
    try {
      application = existing
        ? await this.reapply(existing, fields, keepPrevious)
        : await this.create(userId, vacancyId, fields);
    } catch (error: unknown) {
      await this.deleteFiles([stored.cvKey, stored.coverLetterKey]);
      throw error;
    }

    if (existing) {
      await this.deleteFiles([
        !keepPrevious || stored.cvKey ? existing.cvKey : undefined,
        !keepPrevious || stored.coverLetterKey
          ? existing.coverLetterKey
          : undefined,
      ]);
    }

    return this.toResponse(application);
  }

  async withdraw(id: string, userId: string) {
    const application = await this.applicationModel
      .findById(id)
      .lean<ApplicationRecord>();
    if (!application) throw new NotFoundException('Application not found');
    if (application.user?.toString() !== userId) {
      throw new ForbiddenException('No permission');
    }
    if (application.status === ApplicationStatus.WITHDRAWN) {
      throw new BadRequestException('Application is already withdrawn');
    }
    if (!WITHDRAWABLE_APPLICATION_STATUSES.includes(application.status)) {
      throw new BadRequestException(
        'A rejected application cannot be withdrawn',
      );
    }

    const wasAccepted = application.status === ApplicationStatus.ACCEPTED;
    const updated = await this.applicationModel
      .findOneAndUpdate(
        { _id: id, user: application.user, status: application.status },
        {
          $set: {
            status: ApplicationStatus.WITHDRAWN,
            ...(wasAccepted ? { locked: true } : {}),
          },
          $unset: { message: 1, cvKey: 1, coverLetterKey: 1 },
        },
        { new: true },
      )
      .lean<ApplicationRecord>();
    if (!updated) throw new ConflictException('Application changed, try again');

    await this.deleteFiles([application.cvKey, application.coverLetterKey]);

    return this.toResponse(updated);
  }

  async removeForVacancies(
    vacancyIds: readonly (string | Types.ObjectId)[],
  ): Promise<void> {
    if (vacancyIds.length === 0) return;

    const filter = { vacancy: { $in: vacancyIds } };
    const applications = await this.applicationModel
      .find(filter)
      .select(FILE_KEYS_PROJECTION)
      .lean<ApplicationKeys[]>();

    await this.applicationModel.deleteMany(filter);
    await this.deleteFiles(this.fileKeysOf(applications));
  }

  async detachUser(userId: string): Promise<void> {
    const applications = await this.applicationModel
      .find({ user: userId })
      .select(FILE_KEYS_PROJECTION)
      .lean<ApplicationKeys[]>();
    if (applications.length === 0) return;

    await this.applicationModel.updateMany(
      { user: userId },
      { $unset: { user: 1, message: 1, cvKey: 1, coverLetterKey: 1 } },
    );
    await this.deleteFiles(this.fileKeysOf(applications));
  }

  private async assertOpenForApplications(vacancyId: string): Promise<void> {
    const vacancy = await this.vacancyModel
      .findById(vacancyId)
      .select('status deadline company')
      .lean<Pick<VacancyRecord, 'status' | 'deadline' | 'company'>>();
    if (
      !vacancy ||
      (vacancy.status !== VacancyStatus.PUBLISHED &&
        vacancy.status !== VacancyStatus.CLOSED)
    ) {
      throw new NotFoundException('Vacancy not found');
    }
    if (vacancy.status === VacancyStatus.CLOSED) {
      throw new BadRequestException('This vacancy is closed');
    }
    if (vacancy.deadline.getTime() <= Date.now()) {
      throw new BadRequestException('This vacancy has expired');
    }

    const companyApproved = await this.companyModel.exists({
      _id: vacancy.company,
      approved: true,
    });
    if (!companyApproved) {
      throw new BadRequestException(
        'This company is not accepting applications right now',
      );
    }
  }

  private isReapplyAllowed(application: ApplicationRecord): boolean {
    return (
      ENDED_APPLICATION_STATUSES.some(
        (status) => status === application.status,
      ) &&
      application.submissions === 1 &&
      !application.locked
    );
  }

  private conflictMessage(application: ApplicationRecord): string {
    return WITHDRAWABLE_APPLICATION_STATUSES.includes(application.status)
      ? 'You already applied to this vacancy'
      : 'You cannot apply to this vacancy again';
  }

  private async create(
    userId: string,
    vacancyId: string,
    fields: OptionalFields,
  ): Promise<ApplicationRecord> {
    try {
      const now = new Date();
      const created = await this.applicationModel.create({
        user: new Types.ObjectId(userId),
        vacancy: new Types.ObjectId(vacancyId),
        ...fields,
        appliedAt: now,
        firstAppliedAt: now,
      });

      return created.toObject();
    } catch (error: unknown) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('You already applied to this vacancy');
      }
      throw error;
    }
  }

  private async reapply(
    existing: ApplicationRecord,
    fields: OptionalFields,
    keepPrevious: boolean,
  ): Promise<ApplicationRecord> {
    const previousOutcome =
      existing.status === ApplicationStatus.REJECTED
        ? PreviousOutcome.REJECTED
        : PreviousOutcome.WITHDRAWN;
    const entries = Object.entries(fields);
    const provided = Object.fromEntries(
      entries.filter(([, value]) => value !== undefined),
    );
    const missing = keepPrevious
      ? {}
      : Object.fromEntries(
          entries
            .filter(([, value]) => value === undefined)
            .map(([key]) => [key, 1]),
        );

    const updated = await this.applicationModel
      .findOneAndUpdate(
        {
          _id: existing._id,
          user: existing.user,
          status: { $in: ENDED_APPLICATION_STATUSES },
          submissions: 1,
          locked: false,
        },
        {
          $set: {
            ...provided,
            status: ApplicationStatus.SUBMITTED,
            submissions: MAX_APPLICATION_SUBMISSIONS,
            previousOutcome,
            appliedAt: new Date(),
          },
          ...(Object.keys(missing).length > 0 ? { $unset: missing } : {}),
        },
        { new: true },
      )
      .lean<ApplicationRecord>();
    if (!updated) {
      throw new ConflictException('You cannot apply to this vacancy again');
    }

    return updated;
  }

  private async storeFiles(
    profileCvKey: string | undefined,
    cvFile: Express.Multer.File | undefined,
    coverLetterFile: Express.Multer.File | undefined,
  ): Promise<StoredFiles> {
    const [cv, coverLetter] = await Promise.allSettled([
      profileCvKey
        ? this.s3.copy(profileCvKey, StoragePrefix.CVS)
        : this.uploadPdf(cvFile),
      this.uploadPdf(coverLetterFile),
    ]);
    const cvKey = cv.status === 'fulfilled' ? cv.value : undefined;
    const coverLetterKey =
      coverLetter.status === 'fulfilled' ? coverLetter.value : undefined;

    const failure = [cv, coverLetter].find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failure) {
      const reason: unknown = failure.reason;
      this.logger.error(
        'Failed to store application files',
        reason instanceof Error ? reason.stack : undefined,
      );
      await this.deleteFiles([cvKey, coverLetterKey]);
      throw new InternalServerErrorException('File upload failed');
    }

    return { cvKey, coverLetterKey };
  }

  private async uploadPdf(
    file: Express.Multer.File | undefined,
  ): Promise<string | undefined> {
    if (!file) return undefined;

    const key = this.s3.newKey(StoragePrefix.CVS);
    await this.s3.upload(key, file.buffer, PDF_CONTENT_TYPE);

    return key;
  }

  private fileKeysOf(applications: ApplicationKeys[]): string[] {
    return applications.flatMap(({ cvKey, coverLetterKey }) =>
      [cvKey, coverLetterKey].filter((key): key is string => Boolean(key)),
    );
  }

  private async deleteFiles(keys: (string | undefined)[]): Promise<void> {
    await Promise.all(keys.map((key) => this.s3.deleteQuietly(key)));
  }
}
