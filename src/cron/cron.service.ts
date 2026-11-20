import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Company } from '../companies/schema/company.schema.js';
import { EmailClaim } from '../email-claims/schema/email-claim.schema.js';
import { User } from '../users/schema/user.schema.js';

const UNVERIFIED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CleanupResult {
  users: number;
  companies: number;
  claims: number;
}

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Company.name) private readonly companyModel: Model<Company>,
    @InjectModel(EmailClaim.name)
    private readonly claimModel: Model<EmailClaim>,
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

    const result: CleanupResult = {
      users: users.deletedCount,
      companies: companies.deletedCount,
      claims,
    };
    this.logger.log(
      `Cleanup: ${result.users} users, ${result.companies} companies, ${result.claims} claims deleted`,
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
}
