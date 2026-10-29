import { BadRequestException } from '@nestjs/common';

export const PDF_CONTENT_TYPE = 'application/pdf';

const PDF_SIGNATURE = '%PDF-';

export function assertPdf(buffer: Buffer): void {
  const header = buffer.subarray(0, PDF_SIGNATURE.length).toString('latin1');
  if (header !== PDF_SIGNATURE) {
    throw new BadRequestException('Only PDF files are allowed');
  }
}
