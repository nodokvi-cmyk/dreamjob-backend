import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ApplicationsService } from '../applications/applications.service.js';
import { Application } from '../applications/schema/application.schema.js';
import { BookmarksService } from '../bookmarks/bookmarks.service.js';
import { Bookmark } from '../bookmarks/schema/bookmark.schema.js';
import { CompaniesService } from '../companies/companies.service.js';
import { Company } from '../companies/schema/company.schema.js';
import { EmailClaim } from '../email-claims/schema/email-claim.schema.js';
import { InvitationsService } from '../invitations/invitations.service.js';
import {
  Invitation,
  InvitationStatus,
} from '../invitations/schema/invitation.schema.js';
import { Notification } from '../notifications/schema/notification.schema.js';
import { Publication } from '../publications/schema/publication.schema.js';
import { AuthRole } from '../shared/types/auth-role.js';
import { User } from '../users/schema/user.schema.js';
import { UsersService } from '../users/users.service.js';
import { Vacancy } from '../vacancies/schema/vacancy.schema.js';

const UNVERIFIED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const REPAIR_LIMIT = 100;

export interface RepairResult {
  users: number;
  companies: number;
  vacancies: number;
  publications: number;
  failed: number;
}

export interface CleanupResult {
  users: number;
  companies: number;
  claims: number;
  repaired: RepairResult;
}

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Company.name) private readonly companyModel: Model<Company>,
    @InjectModel(EmailClaim.name)
    private readonly claimModel: Model<EmailClaim>,
    @InjectModel(Publication.name)
    private readonly publicationModel: Model<Publication>,
    @InjectModel(Bookmark.name)
    private readonly bookmarkModel: Model<Bookmark>,
    @InjectModel(Application.name)
    private readonly applicationModel: Model<Application>,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    @InjectModel(Vacancy.name) private readonly vacancyModel: Model<Vacancy>,
    @InjectModel(Invitation.name)
    private readonly invitationModel: Model<Invitation>,
    private readonly usersService: UsersService,
    private readonly companiesService: CompaniesService,
    private readonly applicationsService: ApplicationsService,
    private readonly bookmarksService: BookmarksService,
    private readonly invitationsService: InvitationsService,
  ) {}

  async cleanup(): Promise<CleanupResult> {
    const unverified = {
      isVerified: false,
      createdAt: { $lt: new Date(Date.now() - UNVERIFIED_MAX_AGE_MS) },
    };

    const [users, companies] = await Promise.all([
      this.userModel.deleteMany(unverified),
      this.companyModel.deleteMany(unverified),
    ]);
    const claims = await this.deleteOrphanClaims();
    const repaired = await this.repairOrphans();

    const result: CleanupResult = {
      users: users.deletedCount,
      companies: companies.deletedCount,
      claims,
      repaired,
    };
    this.logger.log(
      `Cleanup: ${result.users} users, ${result.companies} companies, ${result.claims} claims deleted; repaired ${repaired.users} users, ${repaired.companies} companies, ${repaired.vacancies} vacancies, ${repaired.publications} publications, ${repaired.failed} failed`,
    );
    return result;
  }

  private async deleteOrphanClaims(): Promise<number> {
    const orphans = await this.claimModel.aggregate<{ _id: Types.ObjectId }>([
      { $match: { expiresAt: { $exists: false } } },
      {
        $lookup: {
          from: this.userModel.collection.collectionName,
          localField: 'ownerId',
          foreignField: '_id',
          pipeline: [{ $project: { _id: 1 } }],
          as: 'users',
        },
      },
      {
        $lookup: {
          from: this.companyModel.collection.collectionName,
          localField: 'ownerId',
          foreignField: '_id',
          pipeline: [{ $project: { _id: 1 } }],
          as: 'companies',
        },
      },
      { $match: { users: { $size: 0 }, companies: { $size: 0 } } },
      { $project: { _id: 1 } },
    ]);

    if (orphans.length === 0) return 0;

    const { deletedCount } = await this.claimModel.deleteMany({
      _id: { $in: orphans.map((orphan) => orphan._id) },
      expiresAt: { $exists: false },
    });
    return deletedCount;
  }

  private async repairOrphans(): Promise<RepairResult> {
    const users = this.userModel.collection.collectionName;
    const companies = this.companyModel.collection.collectionName;

    const [userIds, companyIds] = await Promise.all([
      this.collectMissing([
        this.missingOwners(this.publicationModel, 'user', users),
        this.missingOwners(this.bookmarkModel, 'user', users),
        this.missingOwners(this.applicationModel, 'user', users),
        this.missingOwners(this.notificationModel, 'recipient', users, {
          recipientRole: AuthRole.USER,
        }),
      ]),
      this.collectMissing([
        this.missingOwners(this.vacancyModel, 'company', companies),
        this.missingOwners(this.invitationModel, 'company', companies),
        this.missingOwners(this.notificationModel, 'recipient', companies, {
          recipientRole: AuthRole.COMPANY,
        }),
      ]),
    ]);

    const result: RepairResult = {
      users: 0,
      companies: 0,
      vacancies: 0,
      publications: 0,
      failed: 0,
    };

    for (const id of userIds) {
      if (await this.repairOne(() => this.usersService.finishRemoval(id))) {
        result.users += 1;
      } else {
        result.failed += 1;
      }
    }
    for (const id of companyIds) {
      if (await this.repairOne(() => this.companiesService.finishRemoval(id))) {
        result.companies += 1;
      } else {
        result.failed += 1;
      }
    }

    await this.repairChildren(result);

    return result;
  }

  private async repairChildren(result: RepairResult): Promise<void> {
    const vacancies = this.vacancyModel.collection.collectionName;
    const publications = this.publicationModel.collection.collectionName;

    const [vacancyIds, publicationIds] = await Promise.all([
      this.collectMissing([
        this.missingOwners(this.applicationModel, 'vacancy', vacancies),
        this.missingOwners(this.bookmarkModel, 'vacancy', vacancies),
        this.missingOwners(this.invitationModel, 'vacancy', vacancies, {
          status: InvitationStatus.INVITED,
        }),
      ]),
      this.collectMissing([
        this.missingOwners(this.invitationModel, 'publication', publications),
      ]),
    ]);

    if (vacancyIds.length > 0) {
      const removed = await this.repairOne(async () => {
        await this.applicationsService.removeForVacancies(vacancyIds);
        await this.bookmarksService.removeForVacancies(vacancyIds);
        await this.invitationsService.releaseForVacancies(vacancyIds);
      });
      if (removed) result.vacancies += vacancyIds.length;
      else result.failed += 1;
    }

    if (publicationIds.length > 0) {
      const removed = await this.repairOne(() =>
        this.invitationsService.removeForPublications(publicationIds),
      );
      if (removed) result.publications += publicationIds.length;
      else result.failed += 1;
    }
  }

  private async collectMissing(
    lookups: Promise<string[]>[],
  ): Promise<string[]> {
    const found = await Promise.all(lookups);
    return [...new Set(found.flat())].slice(0, REPAIR_LIMIT);
  }

  private async missingOwners<T>(
    model: Model<T>,
    field: string,
    ownerCollection: string,
    match: Record<string, unknown> = {},
  ): Promise<string[]> {
    const rows = await model.aggregate<{ _id: Types.ObjectId }>([
      { $match: { ...match, [field]: { $type: 'objectId' } } },
      { $group: { _id: `$${field}` } },
      {
        $lookup: {
          from: ownerCollection,
          localField: '_id',
          foreignField: '_id',
          pipeline: [{ $project: { _id: 1 } }],
          as: 'owner',
        },
      },
      { $match: { owner: { $size: 0 } } },
      { $limit: REPAIR_LIMIT },
      { $project: { _id: 1 } },
    ]);

    return rows.map((row) => row._id.toString());
  }

  private async repairOne(run: () => Promise<void>): Promise<boolean> {
    try {
      await run();
      return true;
    } catch (error: unknown) {
      this.logger.error(
        'Orphan repair step failed',
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }
}
