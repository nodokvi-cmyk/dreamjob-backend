import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

export enum ImageKind {
  AVATAR = 'avatar',
  LOGO = 'logo',
}

export const PROCESSED_IMAGE_CONTENT_TYPE = 'image/webp';

const MAX_IMAGE_SIDE = 512;
const WEBP_QUALITY = 80;
const ALLOWED_FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png', 'webp']);

export async function processImage(
  input: Buffer,
  kind: ImageKind,
): Promise<Buffer> {
  try {
    const { format, width, height } = await sharp(input).metadata();
    if (!format || !ALLOWED_FORMATS.has(format)) {
      throw new BadRequestException(
        'Only JPEG, PNG and WebP images are allowed',
      );
    }

    if (!width || !height) throw new BadRequestException('Invalid image file');

    const side = Math.min(MAX_IMAGE_SIDE, width, height);
    const pipeline = sharp(input).rotate();
    const resized =
      kind === ImageKind.AVATAR
        ? pipeline.resize(side, side, { fit: 'cover' })
        : pipeline.resize(MAX_IMAGE_SIDE, MAX_IMAGE_SIDE, {
            fit: 'inside',
            withoutEnlargement: true,
          });

    return await resized.webp({ quality: WEBP_QUALITY }).toBuffer();
  } catch (error: unknown) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('Invalid image file');
  }
}
