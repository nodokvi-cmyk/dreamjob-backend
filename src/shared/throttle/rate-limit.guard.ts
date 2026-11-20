import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { SharedRateCounter } from './shared-rate-counter.js';
import { THROTTLE_KEY } from './throttle.decorator.js';
import type { ThrottleLimit, ThrottleOptions } from './throttle.decorator.js';

interface Bucket {
  count: number;
  resetAt: number;
}

const DEFAULT_LIMIT: ThrottleLimit = { limit: 30, ttl: 60_000 };
const SWEEP_THRESHOLD = 10_000;

interface ThrottledRequest {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function headerValue(
  headers: ThrottledRequest['headers'],
  name: string,
): string | undefined {
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
}

function tooManyRequests(): HttpException {
  return new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private readonly secretDigest: Buffer;

  constructor(
    private readonly reflector: Reflector,
    private readonly sharedCounter: SharedRateCounter,
    config: ConfigService,
  ) {
    this.secretDigest = digest(
      config.getOrThrow<string>('FRONTEND_SHARED_SECRET'),
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<
      ThrottleOptions | undefined
    >(THROTTLE_KEY, [context.getHandler(), context.getClass()]);
    const { limit, ttl } = options?.default ?? DEFAULT_LIMIT;

    const request = context.switchToHttp().getRequest<ThrottledRequest>();
    const now = Date.now();
    const ip = options?.trustVisitorIp
      ? this.visitorIp(request)
      : (request.ip ?? 'unknown');
    const key = `${ip}:${context.getClass().name}:${context.getHandler().name}`;

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

  private visitorIp(request: ThrottledRequest): string {
    const fallback = request.ip ?? 'unknown';
    const secret = headerValue(request.headers, 'x-frontend-secret');
    const visitor = headerValue(request.headers, 'x-visitor-ip')?.trim();
    if (!secret || !visitor || isIP(visitor) === 0) {
      return fallback;
    }
    return timingSafeEqual(digest(secret), this.secretDigest)
      ? visitor
      : fallback;
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
