import { SetMetadata } from '@nestjs/common';

export const THROTTLE_KEY = 'throttle';

export interface ThrottleLimit {
  limit: number;
  ttl: number;
}

export interface ThrottleOptions {
  default: ThrottleLimit;
}

export const Throttle = (options: ThrottleOptions) =>
  SetMetadata(THROTTLE_KEY, options);
