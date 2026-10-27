import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { isDuplicateKeyError } from '../shared/mongo/is-duplicate-key-error.js';
import { EmailClaim } from './schema/email-claim.schema.js';

const PENDING_CLAIM_MS = 5 * 60 * 1000;

@Injectable()
export class EmailClaimsService {
  constructor(
    @InjectModel(EmailClaim.name)
    private readonly claimModel: Model<EmailClaim>,
  ) {}

  async isTaken(email: string): Promise<boolean> {
    return !!(await this.claimModel.exists({ email }));
  }

  async claim(email: string, ownerId: Types.ObjectId | string): Promise<void> {
    try {
      await this.claimModel.create({
        email,
        ownerId,
        expiresAt: this.pendingExpiry(),
      });
    } catch (error: unknown) {
      if (!isDuplicateKeyError(error)) throw error;

      const existing = await this.claimModel.findOne({ email });
      if (existing?.ownerId.toString() !== ownerId.toString()) {
        throw new ConflictException('Email is already in use');
      }

      await this.claimModel.updateOne(
        { email, expiresAt: { $exists: true } },
        { $set: { expiresAt: this.pendingExpiry() } },
      );
    }
  }

  async confirm(
    email: string,
    ownerId: Types.ObjectId | string,
  ): Promise<void> {
    await this.claimModel.updateOne(
      { email, ownerId },
      { $unset: { expiresAt: 1 } },
    );
  }

  async release(
    email: string,
    ownerId: Types.ObjectId | string,
  ): Promise<void> {
    await this.claimModel.deleteOne({ email, ownerId });
  }

  async releaseAll(ownerId: Types.ObjectId | string): Promise<void> {
    await this.claimModel.deleteMany({ ownerId });
  }

  private pendingExpiry(): Date {
    return new Date(Date.now() + PENDING_CLAIM_MS);
  }
}
