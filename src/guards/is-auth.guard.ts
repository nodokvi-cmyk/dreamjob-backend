import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PasswordSetupService } from '../password-setup/password-setup.service.js';
import { ALLOW_PASSWORD_SETUP_KEY } from '../shared/decorators/allow-password-setup.decorator.js';
import { passwordSetupRequiredError } from '../shared/errors/password-setup-required.js';
import type { AuthenticatedRequest } from '../shared/types/authenticated-request.js';
import { isJwtPayload } from '../shared/types/jwt-payload.js';
import { getBearerToken } from './bearer-token.js';

@Injectable()
export class IsAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly passwordSetupService: PasswordSetupService,
  ) {}

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

    const allowsPasswordSetup = this.reflector.get<boolean | undefined>(
      ALLOW_PASSWORD_SETUP_KEY,
      context.getHandler(),
    );

    if (
      !allowsPasswordSetup &&
      (await this.passwordSetupService.isBlocked(
        payload.accountId,
        payload.accountRole,
      ))
    ) {
      throw passwordSetupRequiredError();
    }

    request.accountId = payload.accountId;
    request.accountRole = payload.accountRole;
    return true;
  }
}
