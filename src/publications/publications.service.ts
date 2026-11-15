import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types, UpdateQuery } from 'mongoose';
import { assertPdf, PDF_CONTENT_TYPE } from '../aws-s3/assert-pdf.js';
import { AwsS3Service } from '../aws-s3/aws-s3.service.js';
import { StoragePrefix } from '../aws-s3/storage-prefix.js';
import { Company } from '../companies/schema/company.schema.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationType } from '../notifications/schema/notification.schema.js';
import {
  exactPattern,
  searchWords,
  wordStartPattern,
} from '../shared/mongo/search-patterns.js';
import { excerpt } from '../shared/text/excerpt.js';
import { AuthRole } from '../shared/types/auth-role.js';
import type { Viewer } from '../shared/types/viewer.js';
import { User } from '../users/schema/user.schema.js';
import {
  EXPIRED_STATUS,
  MS_PER_DAY,
} from '../vacancies/schema/vacancy.schema.js';
import { CreatePublicationDto } from './dto/create-publication.dto.js';
import {
  AdminPublicationsFilterDto,
  PublicationBoardFilterDto,
  PublicationBoardSort,
  PublicationListSort,
  PublicationStatusFilterDto,
} from './dto/publication-filter.dto.js';
import { UpdatePublicationDto } from './dto/update-publication.dto.js';
import {
  expiredFilter,
  isPublicationExpired,
  notExpiredFilter,
  publicationViewStatus,
} from './publication-status.js';
import {
  ACTIVE_PUBLICATION_STATUSES,
  MAX_ACTIVE_PUBLICATIONS,
  Publication,
  PUBLICATION_LIFETIME_DAYS,
  PublicationRecord,
  PublicationStatus,
  PublicationViewStatus,
} from './schema/publication.schema.js';

export type PublicationFileField = 'cvKey' | 'coverLetterKey';

type PublicationFilter = QueryFilter<Publication>;

type PublicationChanges = Partial<
  Pick<
    Publication,
    | 'title'
    | 'about'
    | 'category'
    | 'employmentTypes'
    | 'workModes'
    | 'locations'
    | 'salaryMin'
    | 'salaryMax'
    | 'currency'
    | 'skills'
    | 'experienceYears'
  >
>;

type PublicationUnsets = Partial<
  Record<
    | 'salaryMin'
    | 'salaryMax'
    | 'experienceYears'
    | 'rejectionReason'
    | 'pausedAt',
    1
  >
>;

type ResubmitChanges = {
  set: Pick<Publication, 'status'> & Partial<Pick<Publication, 'pausedAt'>>;
  unset: PublicationUnsets;
};

type PublicationKeys = Pick<PublicationRecord, 'cvKey' | 'coverLetterKey'>;

type PublicationFileAccess = Pick<
  PublicationRecord,
  | 'user'
  | 'cvKey'
  | 'coverLetterKey'
  | 'status'
  | 'acceptingInvites'
  | 'expiresAt'
>;

type BoardVisibility = Pick<
  Publication,
  'status' | 'acceptingInvites' | 'expiresAt'
>;

type PublicationAuthor = {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string;
};

type BoardSortPlan =
  | { ranked: false; order: Record<string, 1 | -1> }
  | {
      ranked: true;
      value: string | Record<string, unknown>;
      direction: 1 | -1;
    };

const NO_INVITATION = 'none';
const MAX_SEARCH_WORDS = 5;
const TOP_PAY = { $ifNull: ['$salaryMax', '$salaryMin'] };

const RESUBMIT_STATUSES: readonly PublicationStatus[] = [
  PublicationStatus.PUBLISHED,
  PublicationStatus.REJECTED,
];
const LIFETIME_MS = PUBLICATION_LIFETIME_DAYS * MS_PER_DAY;
const SORTS: Record<PublicationListSort, Record<string, 1 | -1>> = {
  date: { createdAt: 1 },
  '-date': { createdAt: -1 },
};
const BOARD_SORTS: Record<PublicationBoardSort, BoardSortPlan> = {
  date: { ranked: false, order: SORTS.date },
  '-date': { ranked: false, order: SORTS['-date'] },
  salary: { ranked: true, value: TOP_PAY, direction: 1 },
  '-salary': { ranked: true, value: TOP_PAY, direction: -1 },
  experience: { ranked: true, value: '$experienceYears', direction: 1 },
  '-experience': { ranked: true, value: '$experienceYears', direction: -1 },
};
const FILE_LABELS: Record<PublicationFileField, string> = {
  cvKey: 'CV',
  coverLetterKey: 'Cover letter',
};

const TITLE_RELEVANCE = 3;
const SKILL_RELEVANCE = 2;
const ABOUT_RELEVANCE = 1;

const relevanceScore = (words: string[]): Record<string, unknown> => ({
  $add: words.map((word) => {
    const regex = wordStartPattern(word);
    const matches = (input: unknown) => ({
      $regexMatch: { input, regex, options: 'i' },
    });

    return {
      $cond: [
        matches('$title'),
        TITLE_RELEVANCE,
        {
          $cond: [
            {
              $anyElementTrue: {
                $map: {
                  input: { $ifNull: ['$skills', []] },
                  as: 'skill',
                  in: matches('$$skill'),
                },
              },
            },
            SKILL_RELEVANCE,
            { $cond: [matches('$about'), ABOUT_RELEVANCE, 0] },
          ],
        },
      ],
    };
  }),
});

const allOf = (...filters: PublicationFilter[]): PublicationFilter => {
  const used = filters.filter((filter) => Object.keys(filter).length > 0);

  return used.length > 0 ? { $and: used } : {};
};

@Injectable()
export class PublicationsService {
  constructor(
    @InjectModel(Publication.name)
    private readonly publicationModel: Model<Publication>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Company.name) private readonly companyModel: Model<Company>,
    private readonly s3: AwsS3Service,
    private readonly notifications: NotificationsService,
  ) {}

  toResponse(publication: PublicationRecord, includePrivate: boolean) {
    const response = {
      id: publication._id.toString(),
      user: publication.user.toString(),
      title: publication.title,
      about: publication.about,
      category: publication.category,
      employmentTypes: publication.employmentTypes,
      workModes: publication.workModes,
      locations: publication.locations,
      salaryMin: publication.salaryMin ?? null,
      salaryMax: publication.salaryMax ?? null,
      currency: publication.currency,
      skills: publication.skills,
      experienceYears: publication.experienceYears ?? null,
      acceptingInvites: publication.acceptingInvites,
      hasCv: Boolean(publication.cvKey),
      hasCoverLetter: Boolean(publication.coverLetterKey),
      status: publicationViewStatus(publication),
      expiresAt: publication.expiresAt ?? null,
      createdAt: publication.createdAt,
    };

    if (!includePrivate) return response;

    return {
      ...response,
      rejectionReason: publication.rejectionReason ?? '',
      timerPaused: Boolean(publication.pausedAt),
      updatedAt: publication.updatedAt,
    };
  }

  async create(userId: string, createPublicationDto: CreatePublicationDto) {
    const {
      title,
      about,
      category,
      employmentTypes,
      workModes,
      locations,
      salaryMin,
      salaryMax,
      currency,
      skills,
      experienceYears,
    } = createPublicationDto;

    await this.assertUserExists(userId);
    this.assertSalary(salaryMin ?? undefined, salaryMax ?? undefined);
    if (
      (await this.countActive(userId, new Date())) >= MAX_ACTIVE_PUBLICATIONS
    ) {
      throw this.capError();
    }

    const publication = await this.publicationModel.create({
      user: new Types.ObjectId(userId),
      title,
      about,
      category,
      employmentTypes: employmentTypes ?? [],
      workModes: workModes ?? [],
      locations: locations ?? [],
      salaryMin: salaryMin ?? undefined,
      salaryMax: salaryMax ?? undefined,
      currency,
      skills: skills ?? [],
      experienceYears: experienceYears ?? undefined,
    });

    const [userExists, active] = await Promise.all([
      this.userModel.exists({ _id: userId }),
      this.countActive(userId, new Date()),
    ]);
    if (!userExists || active > MAX_ACTIVE_PUBLICATIONS) {
      await this.publicationModel.deleteOne({ _id: publication._id });
      throw userExists
        ? this.capError()
        : new NotFoundException('User not found');
    }

    return this.toResponse(publication.toObject(), true);
  }

  async listMine(userId: string, query: PublicationStatusFilterDto) {
    const filter = allOf(
      { user: new Types.ObjectId(userId) },
      this.statusFilter(query.status, new Date()),
    );

    return this.listPage(filter, query);
  }

  async listForAdmin(query: AdminPublicationsFilterDto) {
    const filter = allOf(
      query.userId ? { user: new Types.ObjectId(query.userId) } : {},
      this.statusFilter(query.status, new Date()),
    );

    return this.listPage(filter, query);
  }

  async listBoard(query: PublicationBoardFilterDto, viewer: Viewer) {
    if (viewer.accountRole === AuthRole.COMPANY) {
      await this.assertCompanyApproved(viewer.accountId);
    }

    const { page, take } = query;
    const filter = allOf(
      this.boardFilter(new Date()),
      this.buildBoardFilter(query),
    );

    const relevanceWords =
      query.q && !query.sort ? searchWords(query.q, MAX_SEARCH_WORDS) : [];

    const [items, total] = await Promise.all([
      this.findBoardPage(
        filter,
        query.sort,
        relevanceWords,
        (page - 1) * take,
        take,
      ),
      this.publicationModel.countDocuments(filter),
    ]);
    const authors = await this.authorsOf(items);

    return {
      items: items.map((publication) => this.toCard(publication, authors)),
      total,
      page,
      take,
    };
  }

  async findOne(id: string, viewer: Viewer) {
    if (viewer.accountRole === AuthRole.COMPANY) {
      return this.findForCompany(id, viewer.accountId);
    }

    const publication = await this.publicationModel
      .findById(id)
      .lean<PublicationRecord>();
    if (!publication) throw new NotFoundException('Publication not found');

    if (
      viewer.accountRole !== AuthRole.ADMIN &&
      publication.user.toString() !== viewer.accountId
    ) {
      throw new ForbiddenException('No permission');
    }

    return this.toResponse(publication, true);
  }

  async update(
    id: string,
    userId: string,
    updatePublicationDto: UpdatePublicationDto,
  ) {
    const publication = await this.findOwned(id, userId);
    const now = new Date();
    this.assertEditable(publication, now);

    const {
      title,
      about,
      category,
      employmentTypes,
      workModes,
      locations,
      salaryMin,
      salaryMax,
      currency,
      skills,
      experienceYears,
    } = updatePublicationDto;
    const changes: PublicationChanges = {};
    const unsets: PublicationUnsets = {};

    if (title) changes.title = title;
    if (about) changes.about = about;
    if (category) changes.category = category;
    if (employmentTypes) changes.employmentTypes = employmentTypes;
    if (workModes) changes.workModes = workModes;
    if (locations) changes.locations = locations;
    if (typeof salaryMin === 'number') changes.salaryMin = salaryMin;
    if (salaryMin === null) unsets.salaryMin = 1;
    if (typeof salaryMax === 'number') changes.salaryMax = salaryMax;
    if (salaryMax === null) unsets.salaryMax = 1;
    if (currency) changes.currency = currency;
    if (skills) changes.skills = skills;
    if (typeof experienceYears === 'number') {
      changes.experienceYears = experienceYears;
    }
    if (experienceYears === null) unsets.experienceYears = 1;

    if (Object.keys(changes).length === 0 && Object.keys(unsets).length === 0) {
      return this.toResponse(publication, true);
    }

    this.assertSalary(
      unsets.salaryMin
        ? undefined
        : (changes.salaryMin ?? publication.salaryMin),
      unsets.salaryMax
        ? undefined
        : (changes.salaryMax ?? publication.salaryMax),
    );

    const resubmit = this.resubmitChanges(publication, now);
    const allUnsets: PublicationUnsets = { ...unsets, ...resubmit?.unset };
    const update: UpdateQuery<Publication> = {
      $set: { ...changes, ...resubmit?.set },
    };
    if (Object.keys(allUnsets).length > 0) update.$unset = allUnsets;

    const updated = await this.updateOwned(publication, update);

    return this.toResponse(updated, true);
  }

  async setAcceptingInvites(
    id: string,
    userId: string,
    acceptingInvites: boolean,
  ) {
    await this.findOwned(id, userId);

    const updated = await this.publicationModel
      .findOneAndUpdate(
        { _id: id, user: userId },
        { $set: { acceptingInvites } },
        { returnDocument: 'after' },
      )
      .lean<PublicationRecord>();
    if (!updated) throw new NotFoundException('Publication not found');

    return this.toResponse(updated, true);
  }

  async close(id: string, userId: string) {
    await this.findOwned(id, userId);

    const closed = await this.publicationModel
      .findOneAndUpdate(
        { _id: id, user: userId, status: { $ne: PublicationStatus.CLOSED } },
        { $set: { status: PublicationStatus.CLOSED } },
        { returnDocument: 'after' },
      )
      .lean<PublicationRecord>();
    if (!closed) {
      throw new BadRequestException('Publication is already closed');
    }

    return this.toResponse(closed, true);
  }

  async extend(id: string, userId: string) {
    const publication = await this.findOwned(id, userId);
    const previousExpiresAt = publication.expiresAt;
    if (
      publication.status !== PublicationStatus.PUBLISHED ||
      !previousExpiresAt
    ) {
      throw new BadRequestException(
        'Only published publications can be extended',
      );
    }

    const now = new Date();
    if (
      (await this.countActive(userId, now, publication._id)) >=
      MAX_ACTIVE_PUBLICATIONS
    ) {
      throw this.capError();
    }

    const extended = await this.updateOwned(publication, {
      $set: { expiresAt: new Date(now.getTime() + LIFETIME_MS) },
    });

    const othersAfter = await this.countActive(
      userId,
      new Date(),
      publication._id,
    );
    if (othersAfter >= MAX_ACTIVE_PUBLICATIONS) {
      await this.publicationModel.updateOne(
        { _id: id, expiresAt: extended.expiresAt },
        { $set: { expiresAt: previousExpiresAt } },
      );
      throw this.capError();
    }

    return this.toResponse(extended, true);
  }

  async remove(id: string, userId: string) {
    const publication = await this.findOwned(id, userId);

    await this.publicationModel.deleteOne({ _id: id });
    await this.deleteFiles([publication]);

    return this.toResponse(publication, true);
  }

  async setFile(
    id: string,
    userId: string,
    field: PublicationFileField,
    file: Express.Multer.File,
  ) {
    assertPdf(file.buffer);
    const publication = await this.findOwned(id, userId);
    const now = new Date();
    this.assertEditable(publication, now);

    const key = this.s3.newKey(StoragePrefix.CVS);
    await this.s3.upload(key, file.buffer, PDF_CONTENT_TYPE);

    const resubmit = this.resubmitChanges(publication, now);
    const update: UpdateQuery<Publication> = {
      $set: {
        ...(field === 'cvKey' ? { cvKey: key } : { coverLetterKey: key }),
        ...resubmit?.set,
      },
    };
    if (resubmit) update.$unset = resubmit.unset;

    let updated: PublicationRecord;
    try {
      updated = await this.updateOwned(publication, update);
    } catch (error: unknown) {
      await this.s3.deleteQuietly(key);
      throw error;
    }

    await this.s3.deleteQuietly(publication[field]);

    return this.toResponse(updated, true);
  }

  async removeFile(id: string, userId: string, field: PublicationFileField) {
    const publication = await this.findOwned(id, userId);
    const key = publication[field];
    if (!key) throw new NotFoundException(`${FILE_LABELS[field]} not found`);

    const now = new Date();
    this.assertEditable(publication, now);

    const resubmit =
      publication.status === PublicationStatus.REJECTED
        ? this.resubmitChanges(publication, now)
        : undefined;
    const update: UpdateQuery<Publication> = {
      $set: {
        ...(field === 'cvKey' ? { cvKey: '' } : { coverLetterKey: '' }),
        ...resubmit?.set,
      },
    };
    if (resubmit) update.$unset = resubmit.unset;

    const updated = await this.updateOwned(publication, update);
    await this.s3.deleteQuietly(key);

    return this.toResponse(updated, true);
  }

  async fileUrl(id: string, viewer: Viewer, field: PublicationFileField) {
    const publication = await this.publicationModel
      .findById(id)
      .select('user cvKey coverLetterKey status acceptingInvites expiresAt')
      .lean<PublicationFileAccess>();
    const key = publication?.[field];
    if (!publication || !key) throw new NotFoundException('File not found');

    if (!(await this.canOpenFiles(publication, viewer))) {
      throw new NotFoundException('File not found');
    }

    return this.s3.presignedUrl(key);
  }

  async approve(id: string) {
    const now = new Date();
    const publication = await this.findReviewable(id);

    const set: Partial<Pick<Publication, 'status' | 'expiresAt'>> = {
      status: PublicationStatus.PUBLISHED,
    };
    const unset: PublicationUnsets = { rejectionReason: 1 };

    if (!publication.expiresAt) {
      set.expiresAt = new Date(now.getTime() + LIFETIME_MS);
    } else if (publication.pausedAt) {
      const pausedFor = now.getTime() - publication.pausedAt.getTime();
      set.expiresAt = new Date(
        publication.expiresAt.getTime() + Math.max(pausedFor, 0),
      );
      unset.pausedAt = 1;
    }

    const approved = await this.publicationModel
      .findOneAndUpdate(
        { _id: id, updatedAt: publication.updatedAt },
        { $set: set, $unset: unset },
        { returnDocument: 'after' },
      )
      .lean<PublicationRecord>();
    if (!approved) {
      throw new ConflictException('Publication changed, try again');
    }

    await this.notifications.notify(approved.user.toString(), AuthRole.USER, {
      type: NotificationType.PUBLICATION_APPROVED,
      data: { publicationTitle: approved.title },
      target: { publicationId: approved._id.toString() },
    });

    return this.toResponse(approved, true);
  }

  async reject(id: string, reason?: string) {
    const publication = await this.findReviewable(id);

    const update: UpdateQuery<Publication> = reason
      ? {
          $set: {
            status: PublicationStatus.REJECTED,
            rejectionReason: reason,
          },
        }
      : {
          $set: { status: PublicationStatus.REJECTED },
          $unset: { rejectionReason: 1 },
        };

    const rejected = await this.publicationModel
      .findOneAndUpdate({ _id: id, updatedAt: publication.updatedAt }, update, {
        returnDocument: 'after',
      })
      .lean<PublicationRecord>();
    if (!rejected) {
      throw new ConflictException('Publication changed, try again');
    }

    await this.notifications.notify(rejected.user.toString(), AuthRole.USER, {
      type: NotificationType.PUBLICATION_REJECTED,
      data: {
        publicationTitle: rejected.title,
        ...(rejected.rejectionReason
          ? { reason: rejected.rejectionReason }
          : {}),
      },
      target: { publicationId: rejected._id.toString() },
    });

    return this.toResponse(rejected, true);
  }

  async removeForUser(userId: string): Promise<void> {
    const filter = { user: new Types.ObjectId(userId) };
    const publications = await this.publicationModel
      .find(filter)
      .select('cvKey coverLetterKey')
      .lean<PublicationKeys[]>();
    if (publications.length === 0) return;

    await this.publicationModel.deleteMany(filter);
    await this.deleteFiles(publications);
  }

  private async findForCompany(id: string, companyId: string) {
    await this.assertCompanyApproved(companyId);

    const publication = await this.publicationModel
      .findOne({ _id: id, ...this.boardFilter(new Date()) })
      .lean<PublicationRecord>();
    if (!publication) throw new NotFoundException('Publication not found');

    const authors = await this.authorsOf([publication]);

    return {
      ...this.toResponse(publication, false),
      author: authors.get(publication.user.toString()) ?? null,
      invitation: NO_INVITATION,
    };
  }

  private toCard(
    publication: PublicationRecord,
    authors: Map<string, PublicationAuthor>,
  ) {
    return {
      id: publication._id.toString(),
      title: publication.title,
      excerpt: excerpt(publication.about),
      category: publication.category,
      employmentTypes: publication.employmentTypes,
      workModes: publication.workModes,
      locations: publication.locations,
      salaryMin: publication.salaryMin ?? null,
      salaryMax: publication.salaryMax ?? null,
      currency: publication.currency,
      skills: publication.skills,
      experienceYears: publication.experienceYears ?? null,
      hasCv: Boolean(publication.cvKey),
      hasCoverLetter: Boolean(publication.coverLetterKey),
      expiresAt: publication.expiresAt ?? null,
      createdAt: publication.createdAt,
      author: authors.get(publication.user.toString()) ?? null,
      invitation: NO_INVITATION,
    };
  }

  private async authorsOf(
    publications: PublicationRecord[],
  ): Promise<Map<string, PublicationAuthor>> {
    const ids = [
      ...new Set(
        publications.map((publication) => publication.user.toString()),
      ),
    ];
    if (ids.length === 0) return new Map();

    const users = await this.userModel
      .find({ _id: { $in: ids } })
      .select('firstName lastName avatarKey');

    return new Map(
      users.map((user) => [
        user._id.toString(),
        {
          id: user._id.toString(),
          firstName: user.firstName,
          lastName: user.lastName,
          avatarUrl: this.s3.publicUrl(user.avatarKey),
        },
      ]),
    );
  }

  private boardFilter(now: Date): PublicationFilter {
    return {
      status: PublicationStatus.PUBLISHED,
      acceptingInvites: true,
      expiresAt: { $gt: now },
    };
  }

  private isOnBoard(publication: BoardVisibility, now: Date): boolean {
    return (
      publication.status === PublicationStatus.PUBLISHED &&
      publication.acceptingInvites &&
      publication.expiresAt !== undefined &&
      publication.expiresAt.getTime() > now.getTime()
    );
  }

  private buildBoardFilter({
    q,
    category,
    location,
    workMode,
    employmentType,
    salaryMin,
    salaryMax,
    currency,
  }: PublicationBoardFilterDto): PublicationFilter {
    const conditions: PublicationFilter[] = [];

    if (q) {
      for (const word of searchWords(q, MAX_SEARCH_WORDS)) {
        const pattern = wordStartPattern(word);
        conditions.push({
          $or: [
            { title: { $regex: pattern, $options: 'i' } },
            { about: { $regex: pattern, $options: 'i' } },
            { skills: { $regex: pattern, $options: 'i' } },
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
        locations: { $regex: wordStartPattern(location), $options: 'i' },
      });
    }
    if (workMode) {
      conditions.push({
        $or: [{ workModes: workMode }, { workModes: { $size: 0 } }],
      });
    }
    if (employmentType) {
      conditions.push({
        $or: [
          { employmentTypes: employmentType },
          { employmentTypes: { $size: 0 } },
        ],
      });
    }
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

  private async findBoardPage(
    filter: PublicationFilter,
    sort: PublicationBoardSort | undefined,
    relevanceWords: string[],
    skip: number,
    limit: number,
  ): Promise<PublicationRecord[]> {
    if (relevanceWords.length > 0) {
      return this.publicationModel.aggregate<PublicationRecord>([
        { $match: filter },
        { $addFields: { relevance: relevanceScore(relevanceWords) } },
        { $sort: { relevance: -1, createdAt: -1, _id: -1 } },
        { $skip: skip },
        { $limit: limit },
        { $project: { relevance: 0 } },
      ]);
    }

    const plan = BOARD_SORTS[sort ?? '-date'];

    if (plan.ranked) {
      return this.publicationModel.aggregate<PublicationRecord>([
        { $match: filter },
        { $addFields: { rankValue: plan.value } },
        {
          $addFields: {
            hasRank: { $cond: [{ $isNumber: '$rankValue' }, 1, 0] },
          },
        },
        { $sort: { hasRank: -1, rankValue: plan.direction, _id: -1 } },
        { $skip: skip },
        { $limit: limit },
        { $project: { rankValue: 0, hasRank: 0 } },
      ]);
    }

    return this.publicationModel
      .find(filter)
      .sort({ ...plan.order, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean<PublicationRecord[]>();
  }

  private async canOpenFiles(
    publication: PublicationFileAccess,
    viewer: Viewer,
  ): Promise<boolean> {
    switch (viewer.accountRole) {
      case AuthRole.ADMIN:
        return true;
      case AuthRole.USER:
        return publication.user.toString() === viewer.accountId;
      case AuthRole.COMPANY:
        return (
          this.isOnBoard(publication, new Date()) &&
          (await this.isCompanyApproved(viewer.accountId))
        );
    }
  }

  private async isCompanyApproved(companyId: string): Promise<boolean> {
    const approved = await this.companyModel.exists({
      _id: companyId,
      approved: true,
    });

    return approved !== null;
  }

  private async assertCompanyApproved(companyId: string): Promise<void> {
    if (!(await this.isCompanyApproved(companyId))) {
      throw new ForbiddenException('Company is not approved');
    }
  }

  private async listPage(
    filter: PublicationFilter,
    { page, take, sort }: PublicationStatusFilterDto,
  ) {
    const [items, total] = await Promise.all([
      this.publicationModel
        .find(filter)
        .sort({ ...SORTS[sort ?? '-date'], _id: -1 })
        .skip((page - 1) * take)
        .limit(take)
        .lean<PublicationRecord[]>(),
      this.publicationModel.countDocuments(filter),
    ]);

    return {
      items: items.map((publication) => this.toResponse(publication, true)),
      total,
      page,
      take,
    };
  }

  private statusFilter(
    status: PublicationViewStatus | undefined,
    now: Date,
  ): PublicationFilter {
    switch (status) {
      case undefined:
        return {};
      case PublicationStatus.CLOSED:
        return { status: PublicationStatus.CLOSED };
      case EXPIRED_STATUS:
        return expiredFilter(now);
      default:
        return allOf({ status }, notExpiredFilter(now));
    }
  }

  private async countActive(
    userId: string,
    now: Date,
    excludeId?: Types.ObjectId,
  ): Promise<number> {
    return this.publicationModel.countDocuments(
      allOf(
        {
          user: new Types.ObjectId(userId),
          status: { $in: ACTIVE_PUBLICATION_STATUSES },
        },
        excludeId ? { _id: { $ne: excludeId } } : {},
        notExpiredFilter(now),
      ),
    );
  }

  private capError(): BadRequestException {
    return new BadRequestException(
      `You can have at most ${MAX_ACTIVE_PUBLICATIONS} active publications. Close or delete one first`,
    );
  }

  private async findOwned(
    id: string,
    userId: string,
  ): Promise<PublicationRecord> {
    const publication = await this.publicationModel
      .findById(id)
      .lean<PublicationRecord>();
    if (!publication) throw new NotFoundException('Publication not found');

    if (publication.user.toString() !== userId) {
      throw new ForbiddenException('No permission');
    }

    return publication;
  }

  private async updateOwned(
    publication: PublicationRecord,
    update: UpdateQuery<Publication>,
  ): Promise<PublicationRecord> {
    const updated = await this.publicationModel
      .findOneAndUpdate(
        {
          _id: publication._id,
          user: publication.user,
          updatedAt: publication.updatedAt,
        },
        update,
        { returnDocument: 'after' },
      )
      .lean<PublicationRecord>();
    if (!updated) {
      throw new ConflictException('Publication changed, try again');
    }

    return updated;
  }

  private async findReviewable(id: string): Promise<PublicationRecord> {
    const publication = await this.publicationModel
      .findOne({ _id: id, status: PublicationStatus.PENDING })
      .lean<PublicationRecord>();
    if (publication) return publication;

    const exists = await this.publicationModel.exists({ _id: id });
    throw exists
      ? new BadRequestException('Only pending publications can be reviewed')
      : new NotFoundException('Publication not found');
  }

  private async assertUserExists(userId: string): Promise<void> {
    const exists = await this.userModel.exists({ _id: userId });
    if (!exists) throw new NotFoundException('User not found');
  }

  private assertEditable(publication: PublicationRecord, now: Date): void {
    if (publication.status === PublicationStatus.CLOSED) {
      throw new BadRequestException('Closed publications cannot be changed');
    }

    if (isPublicationExpired(publication, now)) {
      throw new BadRequestException(
        'Expired publications must be extended before they can be changed',
      );
    }
  }

  private assertSalary(salaryMin?: number, salaryMax?: number): void {
    if (
      salaryMin !== undefined &&
      salaryMax !== undefined &&
      salaryMin >= salaryMax
    ) {
      throw new BadRequestException('salaryMin must be less than salaryMax');
    }
  }

  private resubmitChanges(
    publication: PublicationRecord,
    now: Date,
  ): ResubmitChanges | undefined {
    if (!RESUBMIT_STATUSES.includes(publication.status)) return undefined;

    return {
      set: {
        status: PublicationStatus.PENDING,
        ...(publication.expiresAt
          ? { pausedAt: publication.pausedAt ?? now }
          : {}),
      },
      unset: { rejectionReason: 1 },
    };
  }

  private async deleteFiles(publications: PublicationKeys[]): Promise<void> {
    const keys = publications
      .flatMap(({ cvKey, coverLetterKey }) => [cvKey, coverLetterKey])
      .filter(Boolean);

    await Promise.all(keys.map((key) => this.s3.deleteQuietly(key)));
  }
}
