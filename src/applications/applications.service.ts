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
import { Model, QueryFilter, Types } from 'mongoose';
import { assertPdf, PDF_CONTENT_TYPE } from '../aws-s3/assert-pdf.js';
import { AwsS3Service } from '../aws-s3/aws-s3.service.js';
import { StoragePrefix } from '../aws-s3/storage-prefix.js';
import type { ApplicationFiles } from '../aws-s3/upload-file.js';
import {
  type CompanySummary,
  companyFieldsOf,
  companySummaries,
} from '../companies/company-summaries.js';
import { Company } from '../companies/schema/company.schema.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationType } from '../notifications/schema/notification.schema.js';
import { isDuplicateKeyError } from '../shared/mongo/is-duplicate-key-error.js';
import {
  searchWords,
  wordStartPattern,
} from '../shared/mongo/search-patterns.js';
import { AuthRole } from '../shared/types/auth-role.js';
import type { Viewer } from '../shared/types/viewer.js';
import { ageFrom, User } from '../users/schema/user.schema.js';
import {
  Vacancy,
  VacancyRecord,
  VacancyStatus,
} from '../vacancies/schema/vacancy.schema.js';
import {
  type MyApplicationSummary,
  userFacingTitle,
} from '../vacancies/vacancy-card.js';
import {
  HIDDEN_FROM_USERS_STATUSES,
  vacancyStatusForUser,
} from '../vacancies/vacancy-status.js';
import {
  applicantAggregateOptions,
  applicantCountPipeline,
  applicantFocusPipeline,
  applicantPagePipeline,
  applicantSearchWords,
} from './applicant-pipeline.js';
import type {
  ApplicantSort,
  ApplicantsFilterDto,
} from './dto/applicants-filter.dto.js';
import { ApplyDto } from './dto/apply.dto.js';
import type { MyApplicationsFilterDto } from './dto/my-applications-filter.dto.js';
import type { UpdateApplicationStatusDto } from './dto/update-application-status.dto.js';
import {
  Application,
  ApplicationRecord,
  ApplicationStatus,
  ENDED_APPLICATION_STATUSES,
  MAX_APPLICATION_SUBMISSIONS,
  PreviousOutcome,
  WITHDRAWABLE_APPLICATION_STATUSES,
} from './schema/application.schema.js';

export type ApplicationFileField = 'cvKey' | 'coverLetterKey';

type ApplicationFilter = QueryFilter<Application>;

type VacancySummarySource = Pick<
  VacancyRecord,
  | '_id'
  | 'title'
  | 'company'
  | 'deadline'
  | 'status'
  | 'submittedAt'
  | 'approvedCard'
>;

type ReapplyState = Pick<
  ApplicationRecord,
  'status' | 'submissions' | 'locked'
>;

type ReapplyVacancy = Pick<
  VacancyRecord,
  'company' | 'deadline' | 'status' | 'submittedAt'
>;

type ApplicantUser = Pick<
  User,
  'firstName' | 'lastName' | 'birthDate' | 'email' | 'phone' | 'avatarKey'
> & { _id: Types.ObjectId };

type ApplicantRow = ApplicationRecord & { applicant?: ApplicantUser | null };

const MAX_TITLE_SEARCH_WORDS = 5;

const VACANCY_SUMMARY_PROJECTION =
  'title company deadline status submittedAt approvedCard';

type StoredFiles = Partial<Pick<Application, 'cvKey' | 'coverLetterKey'>>;

type OptionalFields = Partial<
  Pick<Application, 'message' | 'cvKey' | 'coverLetterKey'>
>;

type ApplicationKeys = Pick<ApplicationRecord, 'cvKey' | 'coverLetterKey'>;

const FILE_KEYS_PROJECTION = 'cvKey coverLetterKey';

const NOTIFIED_STATUS_CHANGES: readonly ApplicationStatus[] = [
  ApplicationStatus.INTERVIEW,
  ApplicationStatus.ACCEPTED,
  ApplicationStatus.REJECTED,
];

type VacancyNotice = Pick<VacancyRecord, 'title' | 'company'>;

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
    private readonly notifications: NotificationsService,
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

    const vacancy = await this.assertOpenForApplications(vacancyId);

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

    await this.removeIfOrphaned(application, vacancyId, userId, [
      stored.cvKey,
      stored.coverLetterKey,
      existing?.cvKey,
      existing?.coverLetterKey,
    ]);

    if (existing) {
      await this.deleteFiles([
        !keepPrevious || stored.cvKey ? existing.cvKey : undefined,
        !keepPrevious || stored.coverLetterKey
          ? existing.coverLetterKey
          : undefined,
      ]);
    }

    await this.notifications.notify(
      vacancy.company.toString(),
      AuthRole.COMPANY,
      {
        type: NotificationType.NEW_APPLICATION,
        data: { vacancyTitle: vacancy.title, isReapply: Boolean(existing) },
        target: { vacancyId, applicationId: application._id.toString() },
      },
    );

    return this.toResponse(application);
  }

  private async removeIfOrphaned(
    application: ApplicationRecord,
    vacancyId: string,
    userId: string,
    callKeys: (string | undefined)[],
  ): Promise<void> {
    const [vacancyExists, userExists] = await Promise.all([
      this.vacancyModel.exists({ _id: vacancyId }),
      this.userModel.exists({ _id: userId }),
    ]);
    if (vacancyExists && userExists) return;

    if (!vacancyExists) {
      await this.applicationModel.deleteOne({ _id: application._id });
      await this.deleteFiles(callKeys);
      throw new NotFoundException('Vacancy not found');
    }

    await this.detachUser(userId);
    await this.deleteFiles(callKeys);
    throw new NotFoundException('User not found');
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
    await this.notifyWithdrawn(application.vacancy, id);

    return this.toResponse(updated);
  }

  async notifyCompanyRevoked(
    companyId: string,
    companyName: string,
  ): Promise<void> {
    try {
      const vacancies = await this.vacancyModel
        .find({ company: companyId })
        .select('_id')
        .lean<{ _id: Types.ObjectId }[]>();
      if (vacancies.length === 0) return;
      const vacancyIds = vacancies.map(({ _id }) => _id);

      const userIds = await this.applicationModel.distinct('user', {
        vacancy: { $in: vacancyIds },
        user: { $exists: true },
        status: { $ne: ApplicationStatus.WITHDRAWN },
      });

      await this.notifications.notifyMany(
        userIds.map((userId) => userId.toString()),
        AuthRole.USER,
        {
          type: NotificationType.APPLICANT_COMPANY_REVOKED,
          data: { companyName },
        },
      );
    } catch (error: unknown) {
      this.logger.error(
        'Failed to notify applicants of a revoked company',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async listMine(userId: string, query: MyApplicationsFilterDto) {
    const { page, take, status, q, sort } = query;
    const user = new Types.ObjectId(userId);
    const words = q ? searchWords(q, MAX_TITLE_SEARCH_WORDS) : [];
    const vacancyIds =
      words.length > 0 ? await this.findVacancyIdsByTitle(user, words) : null;
    if (vacancyIds && vacancyIds.length === 0) {
      return { items: [], total: 0, page, take };
    }

    const filter: ApplicationFilter = {
      user,
      ...(status ? { status } : {}),
      ...(vacancyIds ? { vacancy: { $in: vacancyIds } } : {}),
    };
    const direction = sort === 'date' ? 1 : -1;

    const [applications, total] = await Promise.all([
      this.applicationModel
        .find(filter)
        .sort({ appliedAt: direction, _id: direction })
        .skip((page - 1) * take)
        .limit(take)
        .lean<ApplicationRecord[]>(),
      this.applicationModel.countDocuments(filter),
    ]);
    if (applications.length === 0) return { items: [], total, page, take };

    const vacancies = await this.vacancyModel
      .find({ _id: { $in: applications.map(({ vacancy }) => vacancy) } })
      .select(VACANCY_SUMMARY_PROJECTION)
      .lean<VacancySummarySource[]>();
    const companies = await companySummaries(
      this.companyModel,
      this.s3,
      vacancies.map(({ company }) => company),
    );

    const vacancyById = new Map(
      vacancies.map((vacancy) => [vacancy._id.toString(), vacancy]),
    );

    return {
      items: applications.map((application) => {
        const vacancy = vacancyById.get(application.vacancy.toString());
        const companyApproved = vacancy
          ? companies.approvedIds.has(vacancy.company.toString())
          : false;

        return this.toMyApplicationResponse(
          application,
          vacancy,
          vacancy ? companyFieldsOf(vacancy.company, companies) : undefined,
          companyApproved,
        );
      }),
      total,
      page,
      take,
    };
  }

  async myApplicationsFor(
    userId: string,
    vacancies: readonly (ReapplyVacancy & { _id: Types.ObjectId })[],
    approvedIds: ReadonlySet<string>,
  ): Promise<Map<string, MyApplicationSummary>> {
    if (vacancies.length === 0) return new Map();

    const applications = await this.applicationModel
      .find({
        user: new Types.ObjectId(userId),
        vacancy: { $in: vacancies.map(({ _id }) => _id) },
      })
      .select('vacancy status submissions locked')
      .lean<(ReapplyState & Pick<ApplicationRecord, '_id' | 'vacancy'>)[]>();

    const vacancyById = new Map(
      vacancies.map((vacancy) => [vacancy._id.toString(), vacancy]),
    );

    return new Map(
      applications.map((application) => {
        const vacancyId = application.vacancy.toString();
        const vacancy = vacancyById.get(vacancyId);

        return [
          vacancyId,
          {
            id: application._id.toString(),
            status: application.status,
            canReapply: vacancy
              ? this.canReapply(
                  application,
                  vacancy,
                  approvedIds.has(vacancy.company.toString()),
                )
              : false,
            submissions: application.submissions,
          },
        ];
      }),
    );
  }

  async listApplicants(
    vacancyId: string,
    companyId: string,
    query: ApplicantsFilterDto,
  ) {
    await this.assertManagedBy(vacancyId, companyId);

    const { take, status, focus } = query;
    const sort = query.sort ?? '-date';
    const match: ApplicationFilter = {
      vacancy: new Types.ObjectId(vacancyId),
      ...(status ? { status } : {}),
    };
    const words = applicantSearchWords(query.q);
    const focusPage = focus
      ? await this.findFocusPage(match, sort, words, focus, take)
      : undefined;
    const page = focusPage ?? query.page;

    const [rows, total] = await Promise.all([
      this.applicationModel.aggregate<ApplicantRow>(
        applicantPagePipeline(
          match,
          sort,
          words,
          (page - 1) * take,
          take,
          this.userModel.collection.name,
        ),
        applicantAggregateOptions(sort),
      ),
      this.countApplicants(match, words),
    ]);

    return {
      items: rows.map((row) => this.toApplicantResponse(row)),
      total,
      page,
      take,
    };
  }

  async updateStatus(
    id: string,
    companyId: string,
    { status }: UpdateApplicationStatusDto,
  ) {
    const application = await this.applicationModel
      .findById(id)
      .select('vacancy user status')
      .lean<Pick<ApplicationRecord, 'vacancy' | 'user' | 'status'>>();
    if (!application) throw new NotFoundException('Application not found');

    const { userVacancyTitle, companyName } = await this.assertManagedBy(
      application.vacancy,
      companyId,
    );

    if (application.status === ApplicationStatus.WITHDRAWN) {
      throw new BadRequestException(
        'A withdrawn application cannot be changed',
      );
    }
    if (!application.user) {
      throw new BadRequestException('This applicant deleted their account');
    }

    const updated = await this.applicationModel
      .findOneAndUpdate(
        {
          _id: id,
          user: { $exists: true },
          status: { $ne: ApplicationStatus.WITHDRAWN },
        },
        { $set: { status } },
        { new: true },
      )
      .lean<ApplicationRecord>();
    if (!updated) throw new ConflictException('Application changed, try again');

    if (
      application.status !== status &&
      NOTIFIED_STATUS_CHANGES.includes(status)
    ) {
      await this.notifications.notify(
        application.user.toString(),
        AuthRole.USER,
        {
          type: NotificationType.APPLICATION_STATUS_CHANGED,
          data: { vacancyTitle: userVacancyTitle, companyName, status },
          target: {
            vacancyId: application.vacancy.toString(),
            applicationId: id,
          },
        },
      );
    }

    return {
      id: updated._id.toString(),
      status: updated.status,
      appliedAt: updated.appliedAt,
    };
  }

  async fileUrl(id: string, viewer: Viewer, field: ApplicationFileField) {
    const application = await this.applicationModel
      .findById(id)
      .select('user vacancy status cvKey coverLetterKey')
      .lean<
        Pick<
          ApplicationRecord,
          'user' | 'vacancy' | 'status' | 'cvKey' | 'coverLetterKey'
        >
      >();
    const key = application?.[field];
    if (
      !application ||
      !key ||
      !application.user ||
      application.status === ApplicationStatus.WITHDRAWN
    ) {
      throw new NotFoundException('File not found');
    }

    const allowed =
      viewer.accountRole === AuthRole.USER
        ? application.user.toString() === viewer.accountId
        : viewer.accountRole === AuthRole.COMPANY &&
          (await this.isManagedBy(application.vacancy, viewer.accountId));
    if (!allowed) throw new NotFoundException('File not found');

    return this.s3.presignedUrl(key);
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

  private async notifyWithdrawn(
    vacancyId: Types.ObjectId,
    applicationId: string,
  ): Promise<void> {
    try {
      const vacancy = await this.vacancyModel
        .findById(vacancyId)
        .select('title company')
        .lean<VacancyNotice>();
      if (!vacancy) return;

      await this.notifications.notify(
        vacancy.company.toString(),
        AuthRole.COMPANY,
        {
          type: NotificationType.APPLICATION_WITHDRAWN,
          data: { vacancyTitle: vacancy.title },
          target: { vacancyId: vacancyId.toString(), applicationId },
        },
      );
    } catch (error: unknown) {
      this.logger.error(
        'Failed to notify a company of a withdrawn application',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async assertOpenForApplications(
    vacancyId: string,
  ): Promise<VacancyNotice> {
    const vacancy = await this.vacancyModel
      .findById(vacancyId)
      .select('status deadline company title')
      .lean<Pick<VacancyRecord, 'status' | 'deadline' | 'company' | 'title'>>();
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

    return { title: vacancy.title, company: vacancy.company };
  }

  private async assertManagedBy(
    vacancyId: string | Types.ObjectId,
    companyId: string,
  ): Promise<{ userVacancyTitle: string; companyName: string }> {
    const vacancy = await this.vacancyModel
      .findById(vacancyId)
      .select('company title status approvedCard')
      .lean<
        Pick<VacancyRecord, 'company' | 'title' | 'status' | 'approvedCard'>
      >();
    if (!vacancy) throw new NotFoundException('Vacancy not found');
    if (vacancy.company.toString() !== companyId) {
      throw new ForbiddenException('No permission');
    }

    const company = await this.companyModel
      .findOne({ _id: companyId, approved: true })
      .select('companyName')
      .lean<Pick<Company, 'companyName'>>();
    if (!company) {
      throw new ForbiddenException(
        'Your company must be approved to manage applications',
      );
    }

    return {
      userVacancyTitle: userFacingTitle(vacancy),
      companyName: company.companyName,
    };
  }

  private async isManagedBy(
    vacancyId: Types.ObjectId,
    companyId: string,
  ): Promise<boolean> {
    const [owned, approved] = await Promise.all([
      this.vacancyModel.exists({ _id: vacancyId, company: companyId }),
      this.companyModel.exists({ _id: companyId, approved: true }),
    ]);

    return Boolean(owned && approved);
  }

  private async findVacancyIdsByTitle(
    user: Types.ObjectId,
    words: readonly string[],
  ): Promise<Types.ObjectId[]> {
    const appliedIds = await this.applicationModel.distinct('vacancy', {
      user,
    });
    const patterns = words.map((word) => ({
      $regex: wordStartPattern(word),
      $options: 'i',
    }));
    const liveTitle = patterns.map((pattern) => ({ title: pattern }));
    const approvedTitle = patterns.map((pattern) => ({
      'approvedCard.title': pattern,
    }));

    const matches = await this.vacancyModel
      .find({
        _id: { $in: appliedIds },
        $or: [
          { status: { $nin: HIDDEN_FROM_USERS_STATUSES }, $and: liveTitle },
          {
            status: { $in: HIDDEN_FROM_USERS_STATUSES },
            approvedCard: { $exists: true },
            $and: approvedTitle,
          },
          {
            status: { $in: HIDDEN_FROM_USERS_STATUSES },
            approvedCard: { $exists: false },
            $and: liveTitle,
          },
        ],
      })
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>();

    return matches.map(({ _id }) => _id);
  }

  private async countApplicants(
    match: ApplicationFilter,
    words: readonly string[],
  ): Promise<number> {
    if (words.length === 0) return this.applicationModel.countDocuments(match);

    const [result] = await this.applicationModel.aggregate<{ total: number }>(
      applicantCountPipeline(match, words, this.userModel.collection.name),
    );

    return result?.total ?? 0;
  }

  private async findFocusPage(
    match: ApplicationFilter,
    sort: ApplicantSort,
    words: readonly string[],
    focus: string,
    take: number,
  ): Promise<number | undefined> {
    const [result] = await this.applicationModel.aggregate<{ index: number }>(
      applicantFocusPipeline(
        match,
        sort,
        words,
        new Types.ObjectId(focus),
        this.userModel.collection.name,
      ),
      applicantAggregateOptions(sort),
    );
    if (!result || result.index < 0) return undefined;

    return Math.floor(result.index / take) + 1;
  }

  private toMyApplicationResponse(
    application: ApplicationRecord,
    vacancy: VacancySummarySource | undefined,
    company: CompanySummary | undefined,
    companyApproved: boolean,
  ) {
    const vacancyStatus = vacancy ? vacancyStatusForUser(vacancy) : null;

    return {
      ...this.toResponse(application),
      vacancy: vacancy
        ? {
            id: vacancy._id.toString(),
            title: userFacingTitle(vacancy),
            company: vacancy.company.toString(),
            companyName: company?.companyName ?? '',
            logoUrl: company?.logoUrl ?? '',
            deadline: vacancy.deadline,
            status: vacancyStatus,
          }
        : null,
      companyApproved,
      canReapply: vacancy
        ? this.canReapply(application, vacancy, companyApproved)
        : false,
    };
  }

  private canReapply(
    application: ReapplyState,
    vacancy: ReapplyVacancy,
    companyApproved: boolean,
  ): boolean {
    return (
      this.isReapplyAllowed(application) &&
      vacancyStatusForUser(vacancy) === VacancyStatus.PUBLISHED &&
      companyApproved
    );
  }

  private toApplicantResponse(row: ApplicantRow) {
    const { applicant } = row;
    if (row.status === ApplicationStatus.WITHDRAWN || !row.user || !applicant) {
      return {
        id: row._id.toString(),
        status: row.status,
        appliedAt: row.appliedAt,
        hidden: true as const,
      };
    }

    return {
      id: row._id.toString(),
      status: row.status,
      appliedAt: row.appliedAt,
      firstAppliedAt: row.firstAppliedAt,
      isReapply: row.submissions === MAX_APPLICATION_SUBMISSIONS,
      previousOutcome: row.previousOutcome ?? null,
      message: row.message ?? '',
      hasCv: Boolean(row.cvKey),
      hasCoverLetter: Boolean(row.coverLetterKey),
      hidden: false as const,
      applicant: {
        id: applicant._id.toString(),
        firstName: applicant.firstName,
        lastName: applicant.lastName,
        avatarUrl: this.s3.publicUrl(applicant.avatarKey),
        email: applicant.email,
        phone: applicant.phone,
        age: ageFrom(applicant.birthDate) ?? null,
      },
    };
  }

  private isReapplyAllowed(application: ReapplyState): boolean {
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
