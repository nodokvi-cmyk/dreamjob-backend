import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StoragePrefix } from './storage-prefix.js';

const PRESIGNED_URL_TTL_SECONDS = 300;

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

    const domain = config
      .getOrThrow<string>('CLOUDFRONT_DOMAIN_NAME')
      .replace(/\/+$/, '');
    this.publicBaseUrl = /^https?:\/\//.test(domain)
      ? domain
      : `https://${domain}`;
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
