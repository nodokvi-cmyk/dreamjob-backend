import type { Request } from 'express';
import type { UserRole } from '../../users/schema/user.schema.js';

export type AuthenticatedRequest = Request & {
  userId: string;
  userRole: UserRole;
};
