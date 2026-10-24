import { AuthRole } from './auth-role.js';

export interface JwtPayload {
  accountId: string;
  accountRole: AuthRole;
}

const objectIdPattern = /^[a-f0-9]{24}$/i;
const authRoles: readonly string[] = Object.values(AuthRole);

export const isJwtPayload = (value: unknown): value is JwtPayload => {
  if (typeof value !== 'object' || value === null) return false;
  if (!('accountId' in value) || !('accountRole' in value)) return false;

  const { accountId, accountRole } = value;
  return (
    typeof accountId === 'string' &&
    objectIdPattern.test(accountId) &&
    typeof accountRole === 'string' &&
    authRoles.includes(accountRole)
  );
};
