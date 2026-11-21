import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PasswordSetupService } from '../password-setup/password-setup.service.js';
import type { OptionalAuthRequest } from '../shared/types/optional-auth-request.js';
import { isJwtPayload } from '../shared/types/jwt-payload.js';
import { getBearerToken } from './bearer-token.js';

const WARN_INTERVAL_MS = 60_000;

@Injectable()
export class OptionalAuthGuard implements CanActivate {
  private readonly logger = new Logger(OptionalAuthGuard.name);
  private lastWarnAt = 0;

  constructor(
    private readonly jwtService: JwtService,
    private readonly passwordSetupService: PasswordSetupService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OptionalAuthRequest>();
    const token = getBearerToken(request);
    if (!token) return true;

    let payload: unknown;
    try {
      payload = await this.jwtService.verifyAsync<object>(token);
    } catch {
      return true;
    }

    if (!isJwtPayload(payload)) return true;

    let blocked = true;
    try {
      blocked = await this.passwordSetupService.isBlocked(
        payload.accountId,
        payload.accountRole,
      );
    } catch (error: unknown) {
      this.warnLockCheckFailed(error);
    }
    if (blocked) return true;

    request.accountId = payload.accountId;
    request.accountRole = payload.accountRole;
    return true;
  }

  private warnLockCheckFailed(error: unknown): void {
    const now = Date.now();
    if (now - this.lastWarnAt < WARN_INTERVAL_MS) return;
    this.lastWarnAt = now;
    this.logger.warn(
      `Password-lock check failed, treated as anonymous: ${error instanceof Error ? error.name : 'unknown error'}`,
    );
  }
}
