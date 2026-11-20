import { randomUUID } from 'node:crypto';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cloudFrontBaseUrl } from './cloudfront-url.js';
import { StoragePrefix } from './storage-prefix.js';

const PRESIGNED_URL_TTL_SECONDS = 300;
const DELETE_BATCH_SIZE = 1000;

export interface StoredObject {
  key: string;
  lastModified: Date;
}

export interface DeleteManyResult {
  deleted: number;
  failed: number;
}

@Injectable()
export class AwsS3Service {
  private readonly logger = new Logger(AwsS3Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('AWS_BUCKET_NAME');
    this.client = new S3Client({
      region: config.getOrThrow<string>('AWS_REGION'),
      credentials: {
        accessKeyId: config.getOrThrow<string>('MY_AWS_ACCESS_KEY'),
        secretAccessKey: config.getOrThrow<string>('AWS_SECRET_ACCESS_KEY'),
      },
    });

    this.publicBaseUrl = cloudFrontBaseUrl(
      config.getOrThrow<string>('CLOUDFRONT_DOMAIN_NAME'),
    );
  }

  newKey(prefix: StoragePrefix): string {
    return `${prefix}/${randomUUID()}`;
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async copy(sourceKey: string, prefix: StoragePrefix): Promise<string> {
    const key = this.newKey(prefix);
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: key,
        CopySource: `${this.bucket}/${sourceKey}`,
      }),
    );
    return key;
  }

  async deleteQuietly(key: string | undefined): Promise<void> {
    if (!key) return;

    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error: unknown) {
      this.logger.error(
        `Failed to delete S3 object ${key}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async listObjects(prefix: StoragePrefix): Promise<StoredObject[]> {
    const objects: StoredObject[] = [];
    let continuationToken: string | undefined;

    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `${prefix}/`,
          ContinuationToken: continuationToken,
        }),
      );

      for (const object of page.Contents ?? []) {
        if (object.Key && object.LastModified) {
          objects.push({ key: object.Key, lastModified: object.LastModified });
        }
      }

      continuationToken = page.IsTruncated
        ? page.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return objects;
  }

  async deleteMany(keys: string[]): Promise<DeleteManyResult> {
    let failed = 0;

    for (let start = 0; start < keys.length; start += DELETE_BATCH_SIZE) {
      const batch = keys.slice(start, start + DELETE_BATCH_SIZE);

      try {
        const response = await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: {
              Objects: batch.map((key) => ({ Key: key })),
              Quiet: true,
            },
          }),
        );
        const errors = response.Errors ?? [];
        failed += errors.length;
        for (const error of errors) {
          this.logger.error(
            `Failed to delete S3 object ${error.Key ?? 'unknown'}: ${error.Code ?? 'unknown error'}`,
          );
        }
      } catch (error: unknown) {
        failed += batch.length;
        this.logger.error(
          `Failed to delete a batch of ${batch.length} S3 objects`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    return { deleted: keys.length - failed, failed };
  }

  publicUrl(key: string): string {
    return key ? `${this.publicBaseUrl}/${key}` : '';
  }

  async presignedUrl(key: string): Promise<{ url: string; expiresIn: number }> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: 'application/pdf',
      }),
      { expiresIn: PRESIGNED_URL_TTL_SECONDS },
    );

    return { url, expiresIn: PRESIGNED_URL_TTL_SECONDS };
  }
}
