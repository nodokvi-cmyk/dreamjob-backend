import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';

interface CronRequest {
  headers: Record<string, string | string[] | undefined>;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

@Injectable()
export class CronSecretGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(config: ConfigService) {
    this.expected = digest(
      `Bearer ${config.getOrThrow<string>('CRON_SECRET')}`,
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const { authorization } = context
      .switchToHttp()
      .getRequest<CronRequest>().headers;

    if (
      typeof authorization !== 'string' ||
      !timingSafeEqual(digest(authorization), this.expected)
    ) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
