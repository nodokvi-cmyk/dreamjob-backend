import type { Request } from 'express';
import type { AuthRole } from './auth-role.js';

export type AuthenticatedRequest = Request & {
  accountId: string;
  accountRole: AuthRole;
};
