import { MaxFileSizeValidator, ParseFilePipe } from '@nestjs/common';

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const uploadFilePipe = new ParseFilePipe({
  validators: [new MaxFileSizeValidator({ maxSize: MAX_UPLOAD_BYTES })],
});

export const uploadFilesPipe = new ParseFilePipe({
  validators: [new MaxFileSizeValidator({ maxSize: MAX_UPLOAD_BYTES })],
});

export const optionalUploadFilesPipe = new ParseFilePipe({
  validators: [new MaxFileSizeValidator({ maxSize: MAX_UPLOAD_BYTES })],
  fileIsRequired: false,
});

export const uploadLimits = { fileSize: MAX_UPLOAD_BYTES, files: 1 };

export const MAX_APPLICATION_FILE_BYTES = 2 * 1024 * 1024;

export const applicationUploadLimits = {
  fileSize: MAX_APPLICATION_FILE_BYTES,
  files: 2,
};

export interface ApplicationFiles {
  cv?: Express.Multer.File[];
  coverLetter?: Express.Multer.File[];
}

export const uploadLimitsFor = (files: number) => ({
  fileSize: MAX_UPLOAD_BYTES,
  files,
});
