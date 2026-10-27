import { mongo } from 'mongoose';

const DUPLICATE_KEY_CODE = 11000;

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    error instanceof mongo.MongoServerError && error.code === DUPLICATE_KEY_CODE
  );
}
