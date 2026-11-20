import { SetMetadata } from '@nestjs/common';

export const ALLOW_PASSWORD_SETUP_KEY = 'allowPasswordSetup';
export const AllowPasswordSetup = () =>
  SetMetadata(ALLOW_PASSWORD_SETUP_KEY, true);
