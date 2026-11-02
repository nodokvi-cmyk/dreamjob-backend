import type { AuthRole } from './auth-role.js';

export interface Viewer {
  accountId: string;
  accountRole: AuthRole;
}
