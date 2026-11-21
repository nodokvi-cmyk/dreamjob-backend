import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import { Application } from '../applications/schema/application.schema.js';
import { AwsS3Service } from '../aws-s3/aws-s3.service.js';
import type { StoredObject } from '../aws-s3/aws-s3.service.js';
import { StoragePrefix } from '../aws-s3/storage-prefix.js';
import { Company } from '../companies/schema/company.schema.js';
import { Publication } from '../publications/schema/publication.schema.js';
import { User } from '../users/schema/user.schema.js';
import { Vacancy } from '../vacancies/schema/vacancy.schema.js';

const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;
const SWEPT_PREFIXES: readonly StoragePrefix[] = [
  StoragePrefix.AVATARS,
  StoragePrefix.COMPANY_LOGOS,
  StoragePrefix.CVS,
  StoragePrefix.VACANCY_PHOTOS,
];

export interface S3SweepResult {
  dryRun: boolean;
  scanned: number;
  referenced: number;
  recent: number;
  orphans: number;
  deleted: number;
  failed: number;
  orphanKeys?: string[];
}

@Injectable()
export class S3SweepService {
  private readonly logger = new Logger(S3SweepService.name);

  constructor(
    private readonly awsS3Service: AwsS3Service,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Company.name) private readonly companyModel: Model<Company>,
    @InjectModel(Vacancy.name) private readonly vacancyModel: Model<Vacancy>,
    @InjectModel(Application.name)
    private readonly applicationModel: Model<Application>,
    @InjectModel(Publication.name)
    private readonly publicationModel: Model<Publication>,
  ) {}

  async sweep(dryRun: boolean): Promise<S3SweepResult> {
    const startedAt = Date.now();
    const objects = await this.listAll();
    const referencedKeys = await this.referencedKeys();

    let referenced = 0;
    let recent = 0;
    const orphanKeys: string[] = [];

    for (const object of objects) {
      if (referencedKeys.has(object.key)) {
        referenced += 1;
      } else if (startedAt - object.lastModified.getTime() < GRACE_PERIOD_MS) {
        recent += 1;
      } else {
        orphanKeys.push(object.key);
      }
    }

    const { deleted, failed } = dryRun
      ? { deleted: 0, failed: 0 }
      : await this.awsS3Service.deleteMany(orphanKeys);

    const result: S3SweepResult = {
      dryRun,
      scanned: objects.length,
      referenced,
      recent,
      orphans: orphanKeys.length,
      deleted,
      failed,
    };
    this.logger.log(
      `S3 sweep${dryRun ? ' (dry run)' : ''}: ${result.scanned} scanned, ${result.referenced} referenced, ${result.recent} recent, ${result.orphans} orphans, ${result.deleted} deleted, ${result.failed} failed`,
    );

    return dryRun ? { ...result, orphanKeys } : result;
  }

  private async listAll(): Promise<StoredObject[]> {
    const lists = await Promise.all(
      SWEPT_PREFIXES.map((prefix) => this.awsS3Service.listObjects(prefix)),
    );
    return lists.flat();
  }

  private async referencedKeys(): Promise<Set<string>> {
    const keys = new Set<string>();
    await Promise.all([
      this.collectKeys(this.userModel, 'avatarKey', keys),
      this.collectKeys(this.userModel, 'cvKey', keys),
      this.collectKeys(this.companyModel, 'logoKey', keys),
      this.collectKeys(this.vacancyModel, 'photoKeys', keys, true),
      this.collectKeys(this.applicationModel, 'cvKey', keys),
      this.collectKeys(this.applicationModel, 'coverLetterKey', keys),
      this.collectKeys(this.publicationModel, 'cvKey', keys),
      this.collectKeys(this.publicationModel, 'coverLetterKey', keys),
    ]);
    return keys;
  }

  private async collectKeys<T>(
    model: Model<T>,
    field: string,
    keys: Set<string>,
    isList = false,
  ): Promise<void> {
    const path = `$${field}`;
    const stages: PipelineStage[] = [
      ...(isList ? [{ $unwind: path }] : []),
      { $match: { [field]: { $type: 'string', $ne: '' } } },
      { $project: { _id: 0, key: path } },
    ];

    const cursor = model.aggregate<{ key: unknown }>(stages).cursor();
    for await (const row of cursor) {
      const { key } = row;
      if (typeof key === 'string') keys.add(key);
    }
  }
}
