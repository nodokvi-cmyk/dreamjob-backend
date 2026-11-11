import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Company } from '../companies/schema/company.schema.js';
import type { PaginationDto } from '../shared/dto/pagination.dto.js';
import { isDuplicateKeyError } from '../shared/mongo/is-duplicate-key-error.js';
import { User } from '../users/schema/user.schema.js';
import {
  Vacancy,
  VacancyRecord,
  VacancyStatus,
} from '../vacancies/schema/vacancy.schema.js';
import { vacancyStatusForUser } from '../vacancies/vacancy-status.js';
import { Bookmark, BookmarkRecord } from './schema/bookmark.schema.js';

const VACANCY_SUMMARY_PROJECTION =
  'title category employmentType workMode location salaryMin salaryMax currency deadline company status submittedAt';

type VacancySummarySource = Pick<
  VacancyRecord,
  | '_id'
  | 'title'
  | 'category'
  | 'employmentType'
  | 'workMode'
  | 'location'
  | 'salaryMin'
  | 'salaryMax'
  | 'currency'
  | 'deadline'
  | 'company'
  | 'status'
  | 'submittedAt'
>;

@Injectable()
export class BookmarksService {
  constructor(
    @InjectModel(Bookmark.name) private readonly bookmarkModel: Model<Bookmark>,
    @InjectModel(Vacancy.name) private readonly vacancyModel: Model<Vacancy>,
    @InjectModel(Company.name) private readonly companyModel: Model<Company>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async add(vacancyId: string, userId: string) {
    const userExists = await this.userModel.exists({ _id: userId });
    if (!userExists) throw new NotFoundException('User not found');

    const vacancy = await this.vacancyModel
      .findById(vacancyId)
      .select('status')
      .lean<Pick<VacancyRecord, 'status'>>();
    if (
      !vacancy ||
      (vacancy.status !== VacancyStatus.PUBLISHED &&
        vacancy.status !== VacancyStatus.CLOSED)
    ) {
      throw new NotFoundException('Vacancy not found');
    }

    let created = true;
    try {
      await this.bookmarkModel.create({ user: userId, vacancy: vacancyId });
    } catch (error: unknown) {
      if (!isDuplicateKeyError(error)) throw error;
      created = false;
    }
    if (created) await this.removeIfOrphaned(vacancyId, userId);

    return { bookmarked: true as const };
  }

  private async removeIfOrphaned(
    vacancyId: string,
    userId: string,
  ): Promise<void> {
    const [vacancyExists, userExists] = await Promise.all([
      this.vacancyModel.exists({ _id: vacancyId }),
      this.userModel.exists({ _id: userId }),
    ]);
    if (vacancyExists && userExists) return;

    await this.bookmarkModel.deleteOne({ user: userId, vacancy: vacancyId });
    throw new NotFoundException(
      vacancyExists ? 'User not found' : 'Vacancy not found',
    );
  }

  async remove(vacancyId: string, userId: string) {
    await this.bookmarkModel.deleteOne({ user: userId, vacancy: vacancyId });

    return { bookmarked: false as const };
  }

  async list(userId: string, { page, take }: PaginationDto) {
    const filter = { user: new Types.ObjectId(userId) };

    const [bookmarks, total] = await Promise.all([
      this.bookmarkModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * take)
        .limit(take)
        .lean<BookmarkRecord[]>(),
      this.bookmarkModel.countDocuments(filter),
    ]);
    if (bookmarks.length === 0) return { items: [], total, page, take };

    const vacancies = await this.vacancyModel
      .find({ _id: { $in: bookmarks.map(({ vacancy }) => vacancy) } })
      .select(VACANCY_SUMMARY_PROJECTION)
      .lean<VacancySummarySource[]>();
    const approvedCompanies = await this.companyModel
      .find({
        _id: { $in: vacancies.map(({ company }) => company) },
        approved: true,
      })
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>();

    const vacancyById = new Map(
      vacancies.map((vacancy) => [vacancy._id.toString(), vacancy]),
    );
    const approvedIds = new Set(
      approvedCompanies.map(({ _id }) => _id.toString()),
    );

    return {
      items: bookmarks.map((bookmark) =>
        this.toResponse(
          bookmark,
          vacancyById.get(bookmark.vacancy.toString()),
          approvedIds,
        ),
      ),
      total,
      page,
      take,
    };
  }

  async removeForVacancies(
    vacancyIds: readonly (string | Types.ObjectId)[],
  ): Promise<void> {
    if (vacancyIds.length === 0) return;

    await this.bookmarkModel.deleteMany({ vacancy: { $in: vacancyIds } });
  }

  async removeForUser(userId: string): Promise<void> {
    await this.bookmarkModel.deleteMany({ user: userId });
  }

  private toResponse(
    bookmark: BookmarkRecord,
    vacancy: VacancySummarySource | undefined,
    approvedIds: ReadonlySet<string>,
  ) {
    return {
      id: bookmark._id.toString(),
      createdAt: bookmark.createdAt,
      vacancy: vacancy
        ? {
            id: vacancy._id.toString(),
            title: vacancy.title,
            category: vacancy.category,
            employmentType: vacancy.employmentType,
            workMode: vacancy.workMode,
            location: vacancy.location,
            salaryMin: vacancy.salaryMin ?? null,
            salaryMax: vacancy.salaryMax ?? null,
            currency: vacancy.currency,
            deadline: vacancy.deadline,
            company: vacancy.company.toString(),
            status: vacancyStatusForUser(vacancy),
          }
        : null,
      companyApproved: vacancy
        ? approvedIds.has(vacancy.company.toString())
        : false,
    };
  }
}
