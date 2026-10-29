import { ConflictException, ForbiddenException } from '@nestjs/common';

export const EMAIL_NOT_VERIFIED_CODE = 'EMAIL_NOT_VERIFIED';

export const emailNotVerifiedSignInError = (): ForbiddenException =>
  new ForbiddenException({
    statusCode: 403,
    error: 'Forbidden',
    message: 'Please verify your email before signing in',
    code: EMAIL_NOT_VERIFIED_CODE,
  });

export const emailNotVerifiedSignUpError = (): ConflictException =>
  new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: 'Email is already in use',
    code: EMAIL_NOT_VERIFIED_CODE,
  });
