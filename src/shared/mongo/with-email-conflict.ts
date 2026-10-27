import { ConflictException } from '@nestjs/common';
import { isDuplicateKeyError } from './is-duplicate-key-error.js';

export async function withEmailConflict(
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
  } catch (error: unknown) {
    if (isDuplicateKeyError(error)) {
      throw new ConflictException('Email is already in use');
    }
    throw error;
  }
}
