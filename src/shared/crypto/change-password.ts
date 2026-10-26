import { BadRequestException } from '@nestjs/common';
import { hashPassword, isPasswordMatch } from './password.js';

export const hashChangedPassword = async (
  storedHash: string | undefined,
  currentPassword: string,
  newPassword: string,
): Promise<string> => {
  if (!storedHash || !(await isPasswordMatch(currentPassword, storedHash))) {
    throw new BadRequestException('Current password is incorrect');
  }

  if (await isPasswordMatch(newPassword, storedHash)) {
    throw new BadRequestException(
      'New password must be different from the current password',
    );
  }

  return hashPassword(newPassword);
};
