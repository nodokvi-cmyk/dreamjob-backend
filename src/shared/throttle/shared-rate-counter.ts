import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';

const TIMEOUT_MS = 1000;
const WARN_INTERVAL_MS = 60_000;

class SharedCounterTimeout extends Error {
  override name = 'SharedCounterTimeout';
}

@Injectable()
export class SharedRateCounter {
  private readonly logger = new Logger(SharedRateCounter.name);
  private readonly redis: Redis;
  private lastWarnAt = 0;

  constructor(config: ConfigService) {
    this.redis = new Redis({
      url: config.getOrThrow<string>('UPSTASH_KV_REST_API_URL'),
      token: config.getOrThrow<string>('UPSTASH_KV_REST_API_TOKEN'),
      retry: false,
      enableTelemetry: false,
    });
  }

  async increment(
    key: string,
    ttl: number,
    now: number,
  ): Promise<number | null> {
    const windowKey = `rl:${key}:${Math.floor(now / ttl)}`;
    let timer: NodeJS.Timeout | undefined;
    try {
      const transaction = this.redis.multi();
      transaction.incr(windowKey);
      transaction.pexpire(windowKey, ttl);
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new SharedCounterTimeout()),
          TIMEOUT_MS,
        );
      });
      const [count] = await Promise.race([
        transaction.exec<[number, number]>(),
        timeout,
      ]);
      return typeof count === 'number' ? count : null;
    } catch (error: unknown) {
      this.warn(error);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private warn(error: unknown): void {
    const now = Date.now();
    if (now - this.lastWarnAt < WARN_INTERVAL_MS) return;
    this.lastWarnAt = now;
    const reason = error instanceof Error ? error.name : 'UnknownError';
    this.logger.warn(
      `Shared rate limit unavailable (${reason}), using the in-memory count`,
    );
  }
}
