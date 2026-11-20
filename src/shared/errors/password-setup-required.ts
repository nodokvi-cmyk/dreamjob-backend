import { ForbiddenException } from '@nestjs/common';

export const PASSWORD_SETUP_REQUIRED_CODE = 'PASSWORD_SETUP_REQUIRED';

export const passwordSetupRequiredError = (): ForbiddenException =>
  new ForbiddenException({
    statusCode: 403,
    error: 'Forbidden',
    message: 'Set a password before using your account',
    code: PASSWORD_SETUP_REQUIRED_CODE,
  });
