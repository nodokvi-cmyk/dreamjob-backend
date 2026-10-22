import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../shared/types/authenticated-request.js';
import type { UserRole } from '../schema/user.schema.js';

export const UserRoleParam = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UserRole =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().userRole,
);
