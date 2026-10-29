import { MaxFileSizeValidator, ParseFilePipe } from '@nestjs/common';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const uploadFilePipe = new ParseFilePipe({
  validators: [new MaxFileSizeValidator({ maxSize: MAX_UPLOAD_BYTES })],
});

export const uploadLimits = { fileSize: MAX_UPLOAD_BYTES, files: 1 };
