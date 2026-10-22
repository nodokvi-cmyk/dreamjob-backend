import { UserRole } from '../../users/schema/user.schema.js';

export interface JwtPayload {
  userId: string;
  userRole: UserRole;
}

const objectIdPattern = /^[a-f0-9]{24}$/i;
const userRoles: readonly string[] = Object.values(UserRole);

export const isJwtPayload = (value: unknown): value is JwtPayload => {
  if (typeof value !== 'object' || value === null) return false;
  if (!('userId' in value) || !('userRole' in value)) return false;

  const { userId, userRole } = value;
  return (
    typeof userId === 'string' &&
    objectIdPattern.test(userId) &&
    typeof userRole === 'string' &&
    userRoles.includes(userRole)
  );
};
