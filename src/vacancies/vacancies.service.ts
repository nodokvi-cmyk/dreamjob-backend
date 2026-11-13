import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types, UpdateQuery } from 'mongoose';
import type { ClientSession, Connection } from 'mongoose';
import { ApplicationsService } from '../applications/applications.service.js';
import { AwsS3Service } from '../aws-s3/aws-s3.service.js';
import {
  ImageKind,
  PROCESSED_IMAGE_CONTENT_TYPE,
  processImage,
} from '../aws-s3/process-image.js';
import { StoragePrefix } from '../aws-s3/storage-prefix.js';
import { BookmarksService } from '../bookmarks/bookmarks.service.js';
import {
  companyFieldsOf,
  companySummaries,
} from '../companies/company-summaries.js';
import { Company } from '../companies/schema/company.schema.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationType } from '../notifications/schema/notification.schema.js';
import {
  VacancyBillingResult,
  VacancyBillingService,
} from '../payment/vacancy-billing.service.js';
import {
  exactPattern,
  searchWords,
  wordStartPattern,
} from '../shared/mongo/search-patterns.js';
import { AuthRole } from '../shared/types/auth-role.js';
import type { Viewer } from '../shared/types/viewer.js';
import { CreateVacancyDto } from './dto/create-vacancy.dto.js';
import { UpdateVacancyDto } from './dto/update-vacancy.dto.js';
import {
  AdminVacanciesFilterDto,
  OwnVacanciesFilterDto,
  VacancyFilterDto,
  VacancySort,
} from './dto/vacancy-filter.dto.js';
import {
  CreditSource,
  EXPIRED_STATUS,
  MAX_VACANCY_PHOTOS,
  MS_PER_DAY,
  NOT_SUBMITTED_STATUS,
  VACANCY_WINDOW_DAYS,
  Vacancy,
  VacancyRecord,
  VacancyStatus,
  VacancyViewStatus,
  WorkMode,
} from './schema/vacancy.schema.js';
import {
  cardSnapshotOf,
  cardFields,
  cardMarks,
  type MyApplicationSummary,
  type UserCardContext,
  userVacancyCard,
} from './vacancy-card.js';
import { vacancyViewStatus } from './vacancy-status.js';

type VacancyChanges = Partial<
  Pick<
    Vacancy,
    | 'title'
    | 'description'
    | 'category'
    | 'employmentType'
    | 'workMode'
    | 'location'
    | 'salaryMin'
    | 'salaryMax'
    | 'currency'
    | 'requirements'
    | 'deadline'
  >
>;

type VacancyFilter = QueryFilter<Vacancy>;

type SalaryUnsets = Partial<Record<'salaryMin' | 'salaryMax', 1>>;

type VacancyUnsets = Partial<
  Record<
    | 'salaryMin'
    | 'salaryMax'
    | 'rejectionReason'
    | 'submittedAt'
    | 'creditSource'
    | 'windowPausedAt',
    1
  >
>;

type ResubmitChanges = {
  set: Pick<Vacancy, 'status'> & Partial<Pick<Vacancy, 'windowPausedAt'>>;
  unset: VacancyUnsets;
};

const PUBLIC_STATUSES = [VacancyStatus.PUBLISHED, VacancyStatus.CLOSED];
const RESUBMIT_STATUSES: readonly VacancyStatus[] = [
  VacancyStatus.PUBLISHED,
  VacancyStatus.REJECTED,
];
const MAX_SEARCH_WORDS = 5;
const PHOTO_KEY_PREFIX = `${StoragePrefix.VACANCY_PHOTOS}/`;

const SORTS: Record<
  Exclude<VacancySort, 'salary' | '-salary'>,
  Record<string, 1 | -1>
> = {
  date: { createdAt: 1 },
  '-date': { createdAt: -1 },
  deadline: { deadline: 1 },
  '-deadline': { deadline: -1 },
};

const allOf = (...filters: VacancyFilter[]): VacancyFilter => {
  const used = filters.filter((filter) => Object.keys(filter).length > 0);

  return used.length > 0 ? { $and: used } : {};
};

@Injectable()
export class VacanciesService {
  private readonly logger = new Logger(VacanciesService.name);

  constructor(
    @InjectModel(Vacancy.name) private readonly vacancyModel: Model<Vacancy>,
    @InjectModel(Company.name) private readonly companyModel: Model<Company>,
    @InjectConnection() private readonly connection: Connection,
    private readonly s3: AwsS3Service,
    private readonly billing: VacancyBillingService,
    private readonly applications: ApplicationsService,
    private readonly bookmarks: BookmarksService,
    private readonly notifications: NotificationsService,
  ) {}

  toResponse(vacancy: VacancyRecord, includePrivate: boolean) {
    const response = {
      id: vacancy._id.toString(),
      title: vacancy.title,
      description: vacancy.description,
      category: vacancy.category,
      employmentType: vacancy.employmentType,
      workMode: vacancy.workMode,
      location: vacancy.location,
      salaryMin: vacancy.salaryMin,
      salaryMax: vacancy.salaryMax,
      currency: vacancy.currency,
      requirements: vacancy.requirements,
      deadline: vacancy.deadline,
      status: vacancyViewStatus(vacancy),
      photos: this.photosOf(vacancy),
      company: vacancy.company.toString(),
      createdAt: vacancy.createdAt,
    };

    if (!includePrivate) return response;

    return { ...response, ...this.privateFields(vacancy) };
  }

  private photosOf(vacancy: VacancyRecord) {
    return vacancy.photoKeys.map((key) => ({
      id: key.slice(PHOTO_KEY_PREFIX.length),
      url: this.s3.publicUrl(key),
    }));
  }

  private privateFields(vacancy: VacancyRecord) {
    return {
      rejectionReason: vacancy.rejectionReason ?? '',
      submittedAt: vacancy.submittedAt,
      firstPublishedAt: vacancy.firstPublishedAt,
      freeWindowEndsAt: vacancy.freeWindowEndsAt,
      updatedAt: vacancy.updatedAt,
    };
  }

  private privateCard(vacancy: VacancyRecord) {
    return {
      ...cardFields(vacancy, false),
      status: vacancyViewStatus(vacancy),
      ...this.privateFields(vacancy),
    };
  }

  private async userContext(
    vacancies: VacancyRecord[],
    viewer: Viewer | null,
  ): Promise<UserCardContext> {
    const userId =
      viewer?.accountRole === AuthRole.USER ? viewer.accountId : null;
    const [companies, bookmarked] = await Promise.all([
      companySummaries(
        this.companyModel,
        this.s3,
        vacancies.map(({ company }) => company),
      ),
      userId
        ? this.bookmarks.bookmarkedIds(
            userId,
            vacancies.map(({ _id }) => _id),
          )
        : new Set<string>(),
    ]);
    const applications = userId
      ? await this.applications.myApplicationsFor(
          userId,
          vacancies,
          companies.approvedIds,
        )
      : new Map<string, MyApplicationSummary>();

    return { companies, applications, bookmarked };
  }

  async create(
    companyId: string,
    createVacancyDto: CreateVacancyDto,
    files: Express.Multer.File[] = [],
  ) {
    const {
      title,
      description,
      category,
      employmentType,
      workMode,
      location,
      salaryMin,
      salaryMax,
      currency,
      requirements,
      deadline,
    } = createVacancyDto;

    await this.assertCompanyApproved(companyId);
    this.assertConsistent({
      workMode,
      location: location ?? '',
      salaryMin: salaryMin ?? undefined,
      salaryMax: salaryMax ?? undefined,
    });

    const photoKeys = await this.storePhotos(files);

    try {
      const vacancy = await this.vacancyModel.create({
        title,
        description,
        category,
        employmentType,
        workMode,
        location: location ?? '',
        salaryMin: salaryMin ?? undefined,
        salaryMax: salaryMax ?? undefined,
        currency,
        requirements,
        deadline,
        photoKeys,
        company: new Types.ObjectId(companyId),
      });

      const companyExists = await this.companyModel.exists({ _id: companyId });
      if (!companyExists) {
        await this.vacancyModel.deleteOne({ _id: vacancy._id });
        throw new NotFoundException('Company not found');
      }

      return this.toResponse(vacancy.toObject(), true);
    } catch (error: unknown) {
      await this.deleteFiles(photoKeys);
      throw error;
    }
  }

  async listPublic(query: VacancyFilterDto, viewer: Viewer | null) {
    const now = new Date();
    const filter = allOf(
      { status: VacancyStatus.PUBLISHED, deadline: { $gt: now } },
      this.buildFilter(query),
    );

    const { items, total } = await this.findPageAndCount(filter, query);
    const context = await this.userContext(items, viewer);

    return {
      items: items.map((vacancy) => userVacancyCard(vacancy, context)),
      total,
      page: query.page,
      take: query.take,
    };
  }

  async listOwn(companyId: string, query: OwnVacanciesFilterDto) {
    const filter = allOf(
      { company: new Types.ObjectId(companyId) },
      this.statusFilter(query.status, new Date()),
      this.buildFilter(query),
    );

    const { items, total } = await this.findPageAndCount(filter, query);

    return {
      items: items.map((vacancy) => ({
        ...this.privateCard(vacancy),
        photos: this.photosOf(vacancy),
      })),
      total,
      page: query.page,
      take: query.take,
    };
  }

  async listAll(query: AdminVacanciesFilterDto) {
    const filter = allOf(
      { submittedAt: { $exists: true } },
      query.companyId ? { company: new Types.ObjectId(query.companyId) } : {},
      this.statusFilter(query.status, new Date()),
      this.buildFilter(query),
    );

    const { items, total } = await this.findPageAndCount(filter, query);
    const companies = await companySummaries(
      this.companyModel,
      this.s3,
      items.map(({ company }) => company),
    );

    return {
      items: items.map((vacancy) => ({
        ...this.privateCard(vacancy),
        ...companyFieldsOf(vacancy.company, companies),
        companyApproved: companies.approvedIds.has(vacancy.company.toString()),
      })),
      total,
      page: query.page,
      take: query.take,
    };
  }

  async findOne(id: string, viewer: Viewer | null) {
    const vacancy = await this.vacancyModel
      .findOne(this.visibleTo(id, viewer))
      .lean<VacancyRecord>();
    if (!vacancy) throw new NotFoundException('Vacancy not found');

    const context = await this.userContext([vacancy], viewer);

    return {
      ...this.toResponse(vacancy, this.canSeePrivate(vacancy, viewer)),
      ...companyFieldsOf(vacancy.company, context.companies),
      ...cardMarks(vacancy, context),
    };
  }

  async update(
    id: string,
    companyId: string,
    updateVacancyDto: UpdateVacancyDto,
  ) {
    const vacancy = await this.findOwned(id, companyId);
    await this.assertCompanyApproved(companyId);
    const now = new Date();
    this.assertEditable(vacancy, now);

    const {
      title,
      description,
      category,
      employmentType,
      workMode,
      location,
      salaryMin,
      salaryMax,
      currency,
      requirements,
      deadline,
    } = updateVacancyDto;
    const changes: VacancyChanges = {};
    const unsets: SalaryUnsets = {};

    if (title) changes.title = title;
    if (description) changes.description = description;
    if (category) changes.category = category;
    if (employmentType) changes.employmentType = employmentType;
    if (workMode) changes.workMode = workMode;
    if (typeof location === 'string') changes.location = location;
    if (typeof salaryMin === 'number') changes.salaryMin = salaryMin;
    if (salaryMin === null) unsets.salaryMin = 1;
    if (typeof salaryMax === 'number') changes.salaryMax = salaryMax;
    if (salaryMax === null) unsets.salaryMax = 1;
    if (currency) changes.currency = currency;
    if (requirements) changes.requirements = requirements;

    const isContentChange =
      Object.keys(changes).length > 0 || Object.keys(unsets).length > 0;
    if (deadline) {
      if (
        vacancy.firstPublishedAt &&
        deadline.getTime() > vacancy.deadline.getTime()
      ) {
        throw new BadRequestException(
          'Use the extend route to move the deadline later',
        );
      }
      changes.deadline = deadline;
    }
    if (!isContentChange && !deadline) return this.toResponse(vacancy, true);

    this.assertConsistent({
      workMode: changes.workMode ?? vacancy.workMode,
      location: changes.location ?? vacancy.location,
      salaryMin: unsets.salaryMin
        ? undefined
        : (changes.salaryMin ?? vacancy.salaryMin),
      salaryMax: unsets.salaryMax
        ? undefined
        : (changes.salaryMax ?? vacancy.salaryMax),
    });

    const resubmit = isContentChange
      ? this.resubmitChanges(vacancy, now)
      : undefined;
    const allUnsets: VacancyUnsets = { ...unsets, ...resubmit?.unset };
    const update: UpdateQuery<Vacancy> = {
      $set: { ...changes, ...resubmit?.set },
    };
    if (Object.keys(allUnsets).length > 0) update.$unset = allUnsets;

    const updated = await this.vacancyModel
      .findOneAndUpdate(
        { _id: id, company: companyId, updatedAt: vacancy.updatedAt },
        update,
        { returnDocument: 'after' },
      )
      .lean<VacancyRecord>();
    if (!updated) throw new ConflictException('Vacancy changed, try again');

    return this.toResponse(updated, true);
  }

  async close(id: string, companyId: string) {
    await this.findOwned(id, companyId);

    const closed = await this.vacancyModel
      .findOneAndUpdate(
        {
          _id: id,
          status: VacancyStatus.PUBLISHED,
          deadline: { $gt: new Date() },
        },
        { $set: { status: VacancyStatus.CLOSED } },
        { returnDocument: 'after' },
      )
      .lean<VacancyRecord>();
    if (!closed) {
      throw new BadRequestException(
        'Only active published vacancies can be closed',
      );
    }

    return this.toResponse(closed, true);
  }

  async approve(id: string) {
    const now = new Date();
    const vacancy = await this.findReviewable(id, now);

    const set: Partial<
      Pick<
        Vacancy,
        'status' | 'firstPublishedAt' | 'freeWindowEndsAt' | 'approvedCard'
      >
    > = {
      status: VacancyStatus.PUBLISHED,
      approvedCard: cardSnapshotOf(vacancy),
    };
    const unset: VacancyUnsets = { rejectionReason: 1 };

    if (!vacancy.firstPublishedAt) {
      set.firstPublishedAt = now;
      set.freeWindowEndsAt = new Date(
        now.getTime() + VACANCY_WINDOW_DAYS * MS_PER_DAY,
      );
    } else if (vacancy.windowPausedAt && vacancy.freeWindowEndsAt) {
      const pausedFor = now.getTime() - vacancy.windowPausedAt.getTime();
      set.freeWindowEndsAt = new Date(
        vacancy.freeWindowEndsAt.getTime() + Math.max(pausedFor, 0),
      );
      unset.windowPausedAt = 1;
    }

    const approved = await this.vacancyModel
      .findOneAndUpdate(
        { _id: id, updatedAt: vacancy.updatedAt },
        { $set: set, $unset: unset },
        { returnDocument: 'after' },
      )
      .lean<VacancyRecord>();
    if (!approved) throw new ConflictException('Vacancy changed, try again');

    await this.notifications.notify(
      approved.company.toString(),
      AuthRole.COMPANY,
      {
        type: NotificationType.VACANCY_APPROVED,
        data: { vacancyTitle: approved.title },
        target: { vacancyId: approved._id.toString() },
      },
    );

    return this.toResponse(approved, true);
  }

  async reject(id: string, reason?: string) {
    const now = new Date();
    const vacancy = await this.findReviewable(id, now);
    const refund = this.refundableSource(vacancy);

    const set: Partial<
      Pick<Vacancy, 'status' | 'rejectionReason' | 'windowPausedAt'>
    > = { status: VacancyStatus.REJECTED };
    const unset: VacancyUnsets = {};
    if (reason) set.rejectionReason = reason;
    else unset.rejectionReason = 1;
    if (vacancy.firstPublishedAt && !vacancy.windowPausedAt) {
      set.windowPausedAt = now;
    }
    if (refund) unset.creditSource = 1;

    const update: UpdateQuery<Vacancy> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;
    const filter: VacancyFilter = { _id: id, updatedAt: vacancy.updatedAt };

    const rejected = refund
      ? await this.inTransaction(async (session) => {
          const updated = await this.vacancyModel
            .findOneAndUpdate(filter, update, {
              returnDocument: 'after',
              session,
            })
            .lean<VacancyRecord>();
          if (!updated) {
            throw new ConflictException('Vacancy changed, try again');
          }
          await this.billing.refundCredit(
            vacancy.company.toString(),
            refund,
            session,
          );
          return updated;
        })
      : await this.vacancyModel
          .findOneAndUpdate(filter, update, { returnDocument: 'after' })
          .lean<VacancyRecord>();
    if (!rejected) throw new ConflictException('Vacancy changed, try again');

    await this.notifications.notify(
      rejected.company.toString(),
      AuthRole.COMPANY,
      {
        type: NotificationType.VACANCY_REJECTED,
        data: {
          vacancyTitle: rejected.title,
          ...(rejected.rejectionReason
            ? { reason: rejected.rejectionReason }
            : {}),
        },
        target: { vacancyId: rejected._id.toString() },
      },
    );

    return this.toResponse(rejected, true);
  }

  async submit(id: string, companyId: string) {
    const vacancy = await this.findOwned(id, companyId);
    await this.assertCompanyApproved(companyId);

    return this.billingResponse(await this.billing.submit(vacancy, companyId));
  }

  async extend(id: string, companyId: string, deadline: Date) {
    const vacancy = await this.findOwned(id, companyId);
    await this.assertCompanyApproved(companyId);

    return this.billingResponse(
      await this.billing.extend(vacancy, companyId, deadline),
    );
  }

  async addPhotos(id: string, companyId: string, files: Express.Multer.File[]) {
    const vacancy = await this.findOwned(id, companyId);
    await this.assertCompanyApproved(companyId);
    const now = new Date();
    this.assertEditable(vacancy, now);

    if (vacancy.photoKeys.length + files.length > MAX_VACANCY_PHOTOS) {
      throw new BadRequestException(
        `A vacancy can have at most ${MAX_VACANCY_PHOTOS} photos`,
      );
    }

    const keys = await this.storePhotos(files);
    const update: UpdateQuery<Vacancy> = {
      $push: { photoKeys: { $each: keys } },
    };
    this.applyResubmit(update, vacancy, now);

    const updated = await this.vacancyModel
      .findOneAndUpdate(
        {
          _id: id,
          updatedAt: vacancy.updatedAt,
          $expr: {
            $lte: [{ $size: '$photoKeys' }, MAX_VACANCY_PHOTOS - files.length],
          },
        },
        update,
        { returnDocument: 'after' },
      )
      .lean<VacancyRecord>();
    if (!updated) {
      await this.deleteFiles(keys);
      throw new ConflictException('Vacancy changed, try again');
    }

    return this.toResponse(updated, true);
  }

  async removePhoto(id: string, companyId: string, photoId: string) {
    const vacancy = await this.findOwned(id, companyId);
    await this.assertCompanyApproved(companyId);
    const now = new Date();
    this.assertEditable(vacancy, now);

    const key = `${PHOTO_KEY_PREFIX}${photoId}`;
    if (!vacancy.photoKeys.includes(key)) {
      throw new NotFoundException('Photo not found');
    }

    const update: UpdateQuery<Vacancy> = { $pull: { photoKeys: key } };
    if (vacancy.status === VacancyStatus.REJECTED) {
      this.applyResubmit(update, vacancy, now);
    }

    const updated = await this.vacancyModel
      .findOneAndUpdate(
        { _id: id, updatedAt: vacancy.updatedAt, photoKeys: key },
        update,
        { returnDocument: 'after' },
      )
      .lean<VacancyRecord>();
    if (!updated) throw new ConflictException('Vacancy changed, try again');

    await this.s3.deleteQuietly(key);

    return this.toResponse(updated, true);
  }

  async remove(id: string, accountId: string, accountRole: AuthRole) {
    const vacancy = await this.vacancyModel.findById(id).lean<VacancyRecord>();
    if (!vacancy) throw new NotFoundException('Vacancy not found');

    const isAdmin = accountRole === AuthRole.ADMIN;
    if (isAdmin && !vacancy.submittedAt) {
      throw new NotFoundException('Vacancy not found');
    }
    if (!isAdmin && vacancy.company.toString() !== accountId) {
      throw new ForbiddenException('No permission');
    }

    await this.billing.expireCheckoutQuietly(vacancy.checkoutSessionId);

    const refund = isAdmin ? undefined : this.refundableSource(vacancy);
    if (refund) {
      await this.inTransaction(async (session) => {
        const deleted = await this.vacancyModel.findOneAndDelete(
          { _id: id, updatedAt: vacancy.updatedAt },
          { session },
        );
        if (!deleted) {
          throw new ConflictException('Vacancy changed, try again');
        }
        await this.billing.refundCredit(accountId, refund, session);
      });
    } else {
      await this.vacancyModel.deleteOne({ _id: id });
    }
    await this.applications.removeForVacancies([vacancy._id]);
    await this.bookmarks.removeForVacancies([vacancy._id]);
    await this.deleteFiles(vacancy.photoKeys);

    return this.toResponse(vacancy, true);
  }

  async removeAllByCompany(companyId: string): Promise<void> {
    const vacancies = await this.vacancyModel
      .find({ company: companyId })
      .select('_id photoKeys checkoutSessionId')
      .lean<Pick<VacancyRecord, '_id' | 'photoKeys' | 'checkoutSessionId'>[]>();

    await Promise.all(
      vacancies.map(({ checkoutSessionId }) =>
        this.billing.expireCheckoutQuietly(checkoutSessionId),
      ),
    );
    await this.vacancyModel.deleteMany({ company: companyId });
    const vacancyIds = vacancies.map(({ _id }) => _id);
    await this.applications.removeForVacancies(vacancyIds);
    await this.bookmarks.removeForVacancies(vacancyIds);
    await this.deleteFiles(vacancies.flatMap(({ photoKeys }) => photoKeys));
  }

  private billingResponse(result: VacancyBillingResult) {
    return result.kind === 'checkout'
      ? { status: 'paymentRequired' as const, checkoutUrl: result.checkoutUrl }
      : {
          status: 'done' as const,
          vacancy: this.toResponse(result.vacancy, true),
        };
  }

  private refundableSource(vacancy: VacancyRecord): CreditSource | undefined {
    if (
      vacancy.status !== VacancyStatus.PENDING ||
      !vacancy.submittedAt ||
      vacancy.firstPublishedAt
    ) {
      return undefined;
    }

    return vacancy.creditSource;
  }

  private async inTransaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    return this.connection.transaction(work);
  }

  private async findReviewable(id: string, now: Date): Promise<VacancyRecord> {
    const vacancy = await this.vacancyModel
      .findOne({
        _id: id,
        status: VacancyStatus.PENDING,
        submittedAt: { $exists: true },
        deadline: { $gt: now },
      })
      .lean<VacancyRecord>();
    if (!vacancy) throw await this.reviewError(id);

    return vacancy;
  }

  private canSeePrivate(vacancy: VacancyRecord, viewer: Viewer | null) {
    if (viewer?.accountRole === AuthRole.ADMIN) return true;

    return (
      viewer?.accountRole === AuthRole.COMPANY &&
      viewer.accountId === vacancy.company.toString()
    );
  }

  private visibleTo(id: string, viewer: Viewer | null): VacancyFilter {
    const byId: VacancyFilter = { _id: new Types.ObjectId(id) };

    if (viewer?.accountRole === AuthRole.ADMIN) {
      return { ...byId, submittedAt: { $exists: true } };
    }
    if (viewer?.accountRole === AuthRole.COMPANY) {
      return {
        ...byId,
        $or: [
          { status: { $in: PUBLIC_STATUSES } },
          { company: new Types.ObjectId(viewer.accountId) },
        ],
      };
    }

    return { ...byId, status: { $in: PUBLIC_STATUSES } };
  }

  private buildFilter({
    q,
    category,
    location,
    workMode,
    employmentType,
    salaryMin,
    salaryMax,
    currency,
  }: VacancyFilterDto): VacancyFilter {
    const conditions: VacancyFilter[] = [];

    if (q) {
      for (const word of searchWords(q, MAX_SEARCH_WORDS)) {
        const pattern = wordStartPattern(word);
        conditions.push({
          $or: [
            { title: { $regex: pattern, $options: 'i' } },
            { description: { $regex: pattern, $options: 'i' } },
          ],
        });
      }
    }
    if (category) {
      conditions.push({
        category: { $regex: exactPattern(category), $options: 'i' },
      });
    }
    if (location) {
      conditions.push({
        location: { $regex: wordStartPattern(location), $options: 'i' },
      });
    }
    if (workMode) conditions.push({ workMode });
    if (employmentType) conditions.push({ employmentType });
    if (currency) conditions.push({ currency });
    if (salaryMin) {
      conditions.push({
        $or: [
          { salaryMax: { $gte: salaryMin } },
          { salaryMax: { $exists: false }, salaryMin: { $gte: salaryMin } },
        ],
      });
    }
    if (salaryMax) {
      conditions.push({
        $or: [
          { salaryMin: { $lte: salaryMax } },
          { salaryMin: { $exists: false }, salaryMax: { $lte: salaryMax } },
        ],
      });
    }

    return allOf(...conditions);
  }

  private statusFilter(
    status: VacancyViewStatus | undefined,
    now: Date,
  ): VacancyFilter {
    switch (status) {
      case undefined:
        return {};
      case VacancyStatus.CLOSED:
        return { status: VacancyStatus.CLOSED };
      case NOT_SUBMITTED_STATUS:
        return {
          status: VacancyStatus.PENDING,
          submittedAt: { $exists: false },
        };
      case EXPIRED_STATUS:
        return {
          status: { $ne: VacancyStatus.CLOSED },
          deadline: { $lte: now },
          $nor: [
            { status: VacancyStatus.PENDING, submittedAt: { $exists: false } },
          ],
        };
      case VacancyStatus.PENDING:
        return {
          status: VacancyStatus.PENDING,
          submittedAt: { $exists: true },
          deadline: { $gt: now },
        };
      default:
        return { status, deadline: { $gt: now } };
    }
  }

  private async findPageAndCount(
    filter: VacancyFilter,
    { sort, page, take }: VacancyFilterDto,
  ) {
    const [items, total] = await Promise.all([
      this.findPage(filter, sort, (page - 1) * take, take),
      this.vacancyModel.countDocuments(filter),
    ]);

    return { items, total };
  }

  private async findPage(
    filter: VacancyFilter,
    sort: VacancySort | undefined,
    skip: number,
    limit: number,
  ): Promise<VacancyRecord[]> {
    if (sort === 'salary' || sort === '-salary') {
      return this.vacancyModel.aggregate<VacancyRecord>([
        { $match: filter },
        { $addFields: { topPay: { $ifNull: ['$salaryMax', '$salaryMin'] } } },
        {
          $addFields: {
            hasSalary: { $cond: [{ $eq: ['$topPay', null] }, 0, 1] },
          },
        },
        {
          $sort: {
            hasSalary: -1,
            topPay: sort === 'salary' ? 1 : -1,
            _id: -1,
          },
        },
        { $skip: skip },
        { $limit: limit },
      ]);
    }

    return this.vacancyModel
      .find(filter)
      .sort({ ...SORTS[sort ?? '-date'], _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean<VacancyRecord[]>();
  }

  private async findOwned(
    id: string,
    companyId: string,
  ): Promise<VacancyRecord> {
    const vacancy = await this.vacancyModel.findById(id).lean<VacancyRecord>();
    if (!vacancy) throw new NotFoundException('Vacancy not found');

    if (vacancy.company.toString() !== companyId) {
      throw new ForbiddenException('No permission');
    }

    return vacancy;
  }

  private async assertCompanyApproved(companyId: string): Promise<void> {
    const approved = await this.companyModel.exists({
      _id: companyId,
      approved: true,
    });
    if (!approved) throw new ForbiddenException('Company is not approved');
  }

  private assertEditable(vacancy: VacancyRecord, now: Date): void {
    if (vacancy.status === VacancyStatus.CLOSED) {
      throw new BadRequestException('Closed vacancies cannot be changed');
    }

    if (
      vacancy.firstPublishedAt &&
      vacancy.deadline.getTime() <= now.getTime()
    ) {
      throw new BadRequestException(
        'Expired vacancies must be extended before they can be changed',
      );
    }
  }

  private assertConsistent({
    workMode,
    location,
    salaryMin,
    salaryMax,
  }: {
    workMode: WorkMode;
    location: string;
    salaryMin?: number;
    salaryMax?: number;
  }): void {
    if (workMode !== WorkMode.REMOTE && !location) {
      throw new BadRequestException(
        'Location is required unless the vacancy is remote',
      );
    }

    if (
      salaryMin !== undefined &&
      salaryMax !== undefined &&
      salaryMin > salaryMax
    ) {
      throw new BadRequestException(
        'salaryMin cannot be greater than salaryMax',
      );
    }
  }

  private resubmitChanges(
    vacancy: VacancyRecord,
    now: Date,
  ): ResubmitChanges | undefined {
    if (!RESUBMIT_STATUSES.includes(vacancy.status)) return undefined;

    if (vacancy.firstPublishedAt) {
      return {
        set: {
          status: VacancyStatus.PENDING,
          windowPausedAt: vacancy.windowPausedAt ?? now,
        },
        unset: { rejectionReason: 1 },
      };
    }

    return {
      set: { status: VacancyStatus.PENDING },
      unset: { rejectionReason: 1, submittedAt: 1, creditSource: 1 },
    };
  }

  private applyResubmit(
    update: UpdateQuery<Vacancy>,
    vacancy: VacancyRecord,
    now: Date,
  ): void {
    const resubmit = this.resubmitChanges(vacancy, now);
    if (!resubmit) return;

    update.$set = resubmit.set;
    update.$unset = resubmit.unset;
  }

  private async reviewError(
    id: string,
  ): Promise<NotFoundException | BadRequestException> {
    const exists = await this.vacancyModel.exists({
      _id: id,
      submittedAt: { $exists: true },
    });

    return exists
      ? new BadRequestException(
          'Only pending vacancies with a future deadline can be reviewed',
        )
      : new NotFoundException('Vacancy not found');
  }

  private async storePhotos(files: Express.Multer.File[]): Promise<string[]> {
    const bodies = await Promise.all(
      files.map((file) => processImage(file.buffer, ImageKind.VACANCY)),
    );
    const keys = files.map(() => this.s3.newKey(StoragePrefix.VACANCY_PHOTOS));

    const results = await Promise.allSettled(
      bodies.map((body, index) =>
        this.s3.upload(keys[index], body, PROCESSED_IMAGE_CONTENT_TYPE),
      ),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failure) {
      const reason: unknown = failure.reason;
      this.logger.error(
        'Failed to upload vacancy photos',
        reason instanceof Error ? reason.stack : undefined,
      );
      await this.deleteFiles(keys);
      throw new InternalServerErrorException('Photo upload failed');
    }

    return keys;
  }

  private async deleteFiles(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.s3.deleteQuietly(key)));
  }
}
