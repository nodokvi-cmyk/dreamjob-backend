import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { OptionalAuthRequest } from '../shared/types/optional-auth-request.js';
import { isJwtPayload } from '../shared/types/jwt-payload.js';
import { getBearerToken } from './bearer-token.js';

@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

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

    if (isJwtPayload(payload)) {
      request.accountId = payload.accountId;
      request.accountRole = payload.accountRole;
    }

    return true;
  }
}
