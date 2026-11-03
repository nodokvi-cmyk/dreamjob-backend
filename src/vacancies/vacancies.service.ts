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
import { Model, QueryFilter, Types, UpdateQuery } from 'mongoose';
import { AwsS3Service } from '../aws-s3/aws-s3.service.js';
import {
  ImageKind,
  PROCESSED_IMAGE_CONTENT_TYPE,
  processImage,
} from '../aws-s3/process-image.js';
import { StoragePrefix } from '../aws-s3/storage-prefix.js';
import { Company } from '../companies/schema/company.schema.js';
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
  EXPIRED_STATUS,
  MAX_VACANCY_PHOTOS,
  Vacancy,
  VacancyRecord,
  VacancyStatus,
  VacancyViewStatus,
  WorkMode,
} from './schema/vacancy.schema.js';

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
    private readonly s3: AwsS3Service,
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
      status: this.effectiveStatus(vacancy),
      photos: vacancy.photoKeys.map((key) => ({
        id: key.slice(PHOTO_KEY_PREFIX.length),
        url: this.s3.publicUrl(key),
      })),
      company: vacancy.company.toString(),
      createdAt: vacancy.createdAt,
    };

    if (!includePrivate) return response;

    return {
      ...response,
      rejectionReason: vacancy.rejectionReason ?? '',
      updatedAt: vacancy.updatedAt,
    };
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

      return this.toResponse(vacancy.toObject(), true);
    } catch (error: unknown) {
      await this.deleteFiles(photoKeys);
      throw error;
    }
  }

  listPublic(query: VacancyFilterDto) {
    const now = new Date();
    const filter = allOf(
      { status: VacancyStatus.PUBLISHED, deadline: { $gt: now } },
      this.buildFilter(query),
    );

    return this.paginate(filter, query, false);
  }

  listOwn(companyId: string, query: OwnVacanciesFilterDto) {
    const filter = allOf(
      { company: new Types.ObjectId(companyId) },
      this.statusFilter(query.status, new Date()),
      this.buildFilter(query),
    );

    return this.paginate(filter, query, true);
  }

  listAll(query: AdminVacanciesFilterDto) {
    const filter = allOf(
      query.companyId ? { company: new Types.ObjectId(query.companyId) } : {},
      this.statusFilter(query.status, new Date()),
      this.buildFilter(query),
    );

    return this.paginate(filter, query, true);
  }

  async findOne(id: string, viewer: Viewer | null) {
    const vacancy = await this.vacancyModel
      .findOne(this.visibleTo(id, viewer))
      .lean<VacancyRecord>();
    if (!vacancy) throw new NotFoundException('Vacancy not found');

    return this.toResponse(vacancy, this.canSeePrivate(vacancy, viewer));
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
    if (deadline) changes.deadline = deadline;
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

    const resubmit = isContentChange && this.needsResubmit(vacancy.status);
    const update: UpdateQuery<Vacancy> = {
      $set: resubmit ? { ...changes, status: VacancyStatus.PENDING } : changes,
    };
    if (resubmit || Object.keys(unsets).length > 0) {
      update.$unset = resubmit ? { ...unsets, rejectionReason: 1 } : unsets;
    }

    const updated = await this.vacancyModel
      .findOneAndUpdate(
        {
          _id: id,
          company: companyId,
          status: vacancy.status,
          deadline: { $gt: now },
        },
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
    const vacancy = await this.vacancyModel
      .findOneAndUpdate(
        {
          _id: id,
          status: VacancyStatus.PENDING,
          deadline: { $gt: new Date() },
        },
        {
          $set: { status: VacancyStatus.PUBLISHED },
          $unset: { rejectionReason: 1 },
        },
        { returnDocument: 'after' },
      )
      .lean<VacancyRecord>();
    if (!vacancy) throw await this.reviewError(id);

    return this.toResponse(vacancy, true);
  }

  async reject(id: string, reason?: string) {
    const update: UpdateQuery<Vacancy> = reason
      ? { $set: { status: VacancyStatus.REJECTED, rejectionReason: reason } }
      : {
          $set: { status: VacancyStatus.REJECTED },
          $unset: { rejectionReason: 1 },
        };

    const vacancy = await this.vacancyModel
      .findOneAndUpdate(
        {
          _id: id,
          status: VacancyStatus.PENDING,
          deadline: { $gt: new Date() },
        },
        update,
        { returnDocument: 'after' },
      )
      .lean<VacancyRecord>();
    if (!vacancy) throw await this.reviewError(id);

    return this.toResponse(vacancy, true);
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
    this.applyResubmit(update, vacancy.status);

    const updated = await this.vacancyModel
      .findOneAndUpdate(
        {
          _id: id,
          status: vacancy.status,
          deadline: { $gt: now },
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
      this.applyResubmit(update, vacancy.status);
    }

    const updated = await this.vacancyModel
      .findOneAndUpdate(
        {
          _id: id,
          status: vacancy.status,
          deadline: { $gt: now },
          photoKeys: key,
        },
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

    if (
      accountRole !== AuthRole.ADMIN &&
      vacancy.company.toString() !== accountId
    ) {
      throw new ForbiddenException('No permission');
    }

    await this.vacancyModel.deleteOne({ _id: id });
    await this.deleteFiles(vacancy.photoKeys);

    return this.toResponse(vacancy, true);
  }

  async removeAllByCompany(companyId: string): Promise<void> {
    const vacancies = await this.vacancyModel
      .find({ company: companyId })
      .select('photoKeys')
      .lean<Pick<VacancyRecord, 'photoKeys'>[]>();

    await this.vacancyModel.deleteMany({ company: companyId });
    await this.deleteFiles(vacancies.flatMap(({ photoKeys }) => photoKeys));
  }

  private effectiveStatus(
    vacancy: Pick<Vacancy, 'status' | 'deadline'>,
  ): VacancyViewStatus {
    if (vacancy.status === VacancyStatus.CLOSED) return VacancyStatus.CLOSED;

    return vacancy.deadline.getTime() <= Date.now()
      ? EXPIRED_STATUS
      : vacancy.status;
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

    if (viewer?.accountRole === AuthRole.ADMIN) return byId;
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
      case EXPIRED_STATUS:
        return {
          status: { $ne: VacancyStatus.CLOSED },
          deadline: { $lte: now },
        };
      default:
        return { status, deadline: { $gt: now } };
    }
  }

  private async paginate(
    filter: VacancyFilter,
    { sort, page, take }: VacancyFilterDto,
    includePrivate: boolean,
  ) {
    const [items, total] = await Promise.all([
      this.findPage(filter, sort, (page - 1) * take, take),
      this.vacancyModel.countDocuments(filter),
    ]);

    return {
      items: items.map((vacancy) => this.toResponse(vacancy, includePrivate)),
      total,
      page,
      take,
    };
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

    if (vacancy.deadline.getTime() <= now.getTime()) {
      throw new BadRequestException('Expired vacancies cannot be changed');
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

  private needsResubmit(status: VacancyStatus): boolean {
    return RESUBMIT_STATUSES.includes(status);
  }

  private applyResubmit(
    update: UpdateQuery<Vacancy>,
    status: VacancyStatus,
  ): void {
    if (!this.needsResubmit(status)) return;

    update.$set = { status: VacancyStatus.PENDING };
    update.$unset = { rejectionReason: 1 };
  }

  private async reviewError(
    id: string,
  ): Promise<NotFoundException | BadRequestException> {
    const exists = await this.vacancyModel.exists({ _id: id });

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
