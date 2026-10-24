import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../types/authenticated-request.js';
import type { AuthRole } from '../types/auth-role.js';

export const AccountRole = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthRole =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().accountRole,
);
