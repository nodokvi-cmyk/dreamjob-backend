import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

export enum ImageKind {
  AVATAR = 'avatar',
  LOGO = 'logo',
  VACANCY = 'vacancy',
}

export const PROCESSED_IMAGE_CONTENT_TYPE = 'image/webp';

const MAX_IMAGE_SIDE: Record<ImageKind, number> = {
  [ImageKind.AVATAR]: 512,
  [ImageKind.LOGO]: 512,
  [ImageKind.VACANCY]: 1280,
};
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

    const maxSide = MAX_IMAGE_SIDE[kind];
    const side = Math.min(maxSide, width, height);
    const pipeline = sharp(input).rotate();
    const resized =
      kind === ImageKind.AVATAR
        ? pipeline.resize(side, side, { fit: 'cover' })
        : pipeline.resize(maxSide, maxSide, {
            fit: 'inside',
            withoutEnlargement: true,
          });

    return await resized.webp({ quality: WEBP_QUALITY }).toBuffer();
  } catch (error: unknown) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('Invalid image file');
  }
}
