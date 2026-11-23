import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Company } from '../companies/schema/company.schema.js';
import { isDuplicateKeyError } from '../shared/mongo/is-duplicate-key-error.js';
import { ratingOf } from './rating-value.js';
import { Rating } from './schema/rating.schema.js';

const REPAIR_LIMIT = 100;

interface RatingTotals {
  average: number;
  count: number;
}

interface DriftRow {
  _id: Types.ObjectId;
  average: number;
  count: number;
}

@Injectable()
export class RatingsService {
  constructor(
    @InjectModel(Rating.name) private readonly ratingModel: Model<Rating>,
    @InjectModel(Company.name) private readonly companyModel: Model<Company>,
  ) {}

  async rate(companyId: string, userId: string, stars: number) {
    const approved = await this.companyModel.exists({
      _id: companyId,
      approved: true,
    });
    if (!approved) throw new NotFoundException('Company not found');

    await this.upsertStars(companyId, userId, stars);

    const summary = await this.recompute(companyId);
    if (!summary) {
      await this.ratingModel.deleteMany({ company: companyId });
      throw new NotFoundException('Company not found');
    }

    return { myRating: stars, ...summary };
  }

  async remove(companyId: string, userId: string) {
    const { deletedCount } = await this.ratingModel.deleteOne({
      user: userId,
      company: companyId,
    });
    if (deletedCount === 0) throw new NotFoundException('Rating not found');

    const summary = await this.recompute(companyId);

    return {
      myRating: null,
      ...(summary ?? { rating: null, ratingCount: 0 }),
    };
  }

  async findMine(companyId: string, userId: string): Promise<number | null> {
    const rating = await this.ratingModel
      .findOne({ user: userId, company: companyId })
      .select('stars')
      .lean<{ stars: number }>();

    return rating?.stars ?? null;
  }

  async removeForUser(userId: string): Promise<void> {
    const companyIds = await this.ratingModel.distinct('company', {
      user: userId,
    });
    if (companyIds.length === 0) return;

    await this.ratingModel.deleteMany({ user: userId });
    for (const companyId of companyIds) {
      await this.recompute(companyId.toString());
    }
  }

  async removeForCompany(companyId: string): Promise<void> {
    await this.ratingModel.deleteMany({ company: companyId });
  }

  async repairCounts(): Promise<number> {
    const drifted = await this.ratingModel.aggregate<DriftRow>([
      {
        $group: {
          _id: '$company',
          average: { $avg: '$stars' },
          count: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: this.companyModel.collection.collectionName,
          localField: '_id',
          foreignField: '_id',
          pipeline: [{ $project: { ratingAverage: 1, ratingCount: 1 } }],
          as: 'company',
        },
      },
      { $match: { company: { $size: 1 } } },
      { $unwind: '$company' },
      {
        $match: {
          $expr: {
            $or: [
              { $ne: ['$count', { $ifNull: ['$company.ratingCount', 0] }] },
              {
                $gt: [
                  {
                    $abs: {
                      $subtract: [
                        '$average',
                        { $ifNull: ['$company.ratingAverage', 0] },
                      ],
                    },
                  },
                  1e-9,
                ],
              },
            ],
          },
        },
      },
      { $limit: REPAIR_LIMIT },
      { $project: { average: 1, count: 1 } },
    ]);

    for (const row of drifted) {
      await this.companyModel.updateOne(
        { _id: row._id },
        {
          $set: {
            ratingAverage: row.average,
            ratingCount: row.count,
          },
        },
      );
    }

    const emptied = await this.companyModel.aggregate<{ _id: Types.ObjectId }>([
      { $match: { ratingCount: { $gt: 0 } } },
      {
        $lookup: {
          from: this.ratingModel.collection.collectionName,
          localField: '_id',
          foreignField: 'company',
          pipeline: [{ $limit: 1 }, { $project: { _id: 1 } }],
          as: 'ratings',
        },
      },
      { $match: { ratings: { $size: 0 } } },
      { $limit: REPAIR_LIMIT },
      { $project: { _id: 1 } },
    ]);

    if (emptied.length > 0) {
      await this.companyModel.updateMany(
        { _id: { $in: emptied.map(({ _id }) => _id) } },
        { $set: { ratingAverage: 0, ratingCount: 0 } },
      );
    }

    return drifted.length + emptied.length;
  }

  private async upsertStars(
    companyId: string,
    userId: string,
    stars: number,
  ): Promise<void> {
    const write = () =>
      this.ratingModel.updateOne(
        { user: userId, company: companyId },
        { $set: { stars } },
        { upsert: true },
      );

    try {
      await write();
    } catch (error: unknown) {
      if (!isDuplicateKeyError(error)) throw error;
      await write();
    }
  }

  private async recompute(companyId: string) {
    const [totals] = await this.ratingModel.aggregate<RatingTotals>([
      { $match: { company: new Types.ObjectId(companyId) } },
      {
        $group: { _id: null, average: { $avg: '$stars' }, count: { $sum: 1 } },
      },
    ]);

    const ratingAverage = totals ? totals.average : 0;
    const ratingCount = totals?.count ?? 0;

    const { matchedCount } = await this.companyModel.updateOne(
      { _id: companyId },
      { $set: { ratingAverage, ratingCount } },
    );
    if (matchedCount === 0) return null;

    return { rating: ratingOf(ratingAverage, ratingCount), ratingCount };
  }
}
