import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SharedRateCounter } from './shared-rate-counter.js';
import { THROTTLE_KEY } from './throttle.decorator.js';
import type { ThrottleLimit, ThrottleOptions } from './throttle.decorator.js';

interface Bucket {
  count: number;
  resetAt: number;
}

const DEFAULT_LIMIT: ThrottleLimit = { limit: 30, ttl: 60_000 };
const SWEEP_THRESHOLD = 10_000;

function tooManyRequests(): HttpException {
  return new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly reflector: Reflector,
    private readonly sharedCounter: SharedRateCounter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<
      ThrottleOptions | undefined
    >(THROTTLE_KEY, [context.getHandler(), context.getClass()]);
    const { limit, ttl } = options?.default ?? DEFAULT_LIMIT;

    const request = context.switchToHttp().getRequest<{ ip?: string }>();
    const now = Date.now();
    const key = `${request.ip ?? 'unknown'}:${context.getClass().name}:${context.getHandler().name}`;

    if (this.buckets.size > SWEEP_THRESHOLD) {
      this.sweep(now);
    }

    if (!this.takeLocal(key, limit, ttl, now)) {
      throw tooManyRequests();
    }

    if (!options?.shared) {
      return true;
    }

    const sharedCount = await this.sharedCounter.increment(key, ttl, now);
    if (sharedCount !== null && sharedCount > limit) {
      throw tooManyRequests();
    }
    return true;
  }

  private takeLocal(
    key: string,
    limit: number,
    ttl: number,
    now: number,
  ): boolean {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + ttl });
      return true;
    }

    if (bucket.count >= limit) {
      return false;
    }

    bucket.count += 1;
    return true;
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
