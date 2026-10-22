import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedRequest } from '../shared/types/authenticated-request.js';
import { isJwtPayload } from '../shared/types/jwt-payload.js';

@Injectable()
export class IsAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.getTokenFromHeaders(request);

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

    request.userId = payload.userId;
    request.userRole = payload.userRole;
    return true;
  }

  private getTokenFromHeaders(request: AuthenticatedRequest): string | null {
    const authorization = request.headers.authorization;
    if (!authorization) return null;

    const [type, token] = authorization.split(' ');
    if (!token) return null;

    return type === 'Bearer' ? token : null;
  }
}
