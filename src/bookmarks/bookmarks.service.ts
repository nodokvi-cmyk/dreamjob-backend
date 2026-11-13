import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ApplicationsService } from '../applications/applications.service.js';
import { AwsS3Service } from '../aws-s3/aws-s3.service.js';
import { companySummaries } from '../companies/company-summaries.js';
import { Company } from '../companies/schema/company.schema.js';
import type { PaginationDto } from '../shared/dto/pagination.dto.js';
import { isDuplicateKeyError } from '../shared/mongo/is-duplicate-key-error.js';
import { User } from '../users/schema/user.schema.js';
import {
  Vacancy,
  VacancyRecord,
  VacancyStatus,
} from '../vacancies/schema/vacancy.schema.js';
import {
  type UserCardContext,
  userVacancyCard,
  VACANCY_CARD_PROJECTION,
  type VacancyCardSource,
} from '../vacancies/vacancy-card.js';
import { Bookmark, BookmarkRecord } from './schema/bookmark.schema.js';

@Injectable()
export class BookmarksService {
  constructor(
    @InjectModel(Bookmark.name) private readonly bookmarkModel: Model<Bookmark>,
    @InjectModel(Vacancy.name) private readonly vacancyModel: Model<Vacancy>,
    @InjectModel(Company.name) private readonly companyModel: Model<Company>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly applications: ApplicationsService,
    private readonly s3: AwsS3Service,
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
      .select(VACANCY_CARD_PROJECTION)
      .lean<VacancyCardSource[]>();
    const companies = await companySummaries(
      this.companyModel,
      this.s3,
      vacancies.map(({ company }) => company),
    );
    const applications = await this.applications.myApplicationsFor(
      userId,
      vacancies,
      companies.approvedIds,
    );
    const context: UserCardContext = {
      companies,
      applications,
      bookmarked: new Set(vacancies.map(({ _id }) => _id.toString())),
    };

    const vacancyById = new Map(
      vacancies.map((vacancy) => [vacancy._id.toString(), vacancy]),
    );

    return {
      items: bookmarks.map((bookmark) =>
        this.toResponse(
          bookmark,
          vacancyById.get(bookmark.vacancy.toString()),
          context,
        ),
      ),
      total,
      page,
      take,
    };
  }

  async bookmarkedIds(
    userId: string,
    vacancyIds: readonly Types.ObjectId[],
  ): Promise<Set<string>> {
    if (vacancyIds.length === 0) return new Set();

    const vacancies: Types.ObjectId[] = await this.bookmarkModel.distinct(
      'vacancy',
      { user: new Types.ObjectId(userId), vacancy: { $in: vacancyIds } },
    );

    return new Set(vacancies.map((id) => id.toString()));
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
    vacancy: VacancyCardSource | undefined,
    context: UserCardContext,
  ) {
    return {
      id: bookmark._id.toString(),
      createdAt: bookmark.createdAt,
      vacancy: vacancy ? userVacancyCard(vacancy, context) : null,
    };
  }
}
