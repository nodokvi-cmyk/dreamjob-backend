import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedRequest } from '../shared/types/authenticated-request.js';
import { isJwtPayload } from '../shared/types/jwt-payload.js';
import { getBearerToken } from './bearer-token.js';

@Injectable()
export class IsAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = getBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Authentication token is required');
    }

    let payload: unknown;
    try {
      payload = await this.jwtService.verifyAsync<object>(token);
    } catch {
      throw new UnauthorizedException('Permission denied');
    }

    if (!isJwtPayload(payload)) {
      throw new UnauthorizedException('Permission denied');
    }

    request.accountId = payload.accountId;
    request.accountRole = payload.accountRole;
    return true;
  }
}
