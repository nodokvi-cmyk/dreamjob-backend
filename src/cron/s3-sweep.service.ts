import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
    const lists: unknown[][] = await Promise.all([
      this.userModel.distinct('avatarKey'),
      this.userModel.distinct('cvKey'),
      this.companyModel.distinct('logoKey'),
      this.vacancyModel.distinct('photoKeys'),
      this.applicationModel.distinct('cvKey'),
      this.applicationModel.distinct('coverLetterKey'),
      this.publicationModel.distinct('cvKey'),
      this.publicationModel.distinct('coverLetterKey'),
    ]);

    const keys = new Set<string>();
    for (const list of lists) {
      for (const key of list) {
        if (typeof key === 'string' && key !== '') keys.add(key);
      }
    }
    return keys;
  }
}
