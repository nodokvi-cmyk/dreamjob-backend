import { UserRole } from '../../users/schema/user.schema.js';

export enum AuthRole {
  USER = 'user',
  ADMIN = 'admin',
  COMPANY = 'company',
}

export const authRoleByUserRole: Record<UserRole, AuthRole> = {
  [UserRole.USER]: AuthRole.USER,
  [UserRole.ADMIN]: AuthRole.ADMIN,
};
