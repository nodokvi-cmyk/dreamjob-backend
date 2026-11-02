import type { Request } from 'express';

export function getBearerToken(request: Request): string | null {
  const authorization = request.headers.authorization;
  if (!authorization) return null;

  const [type, token] = authorization.split(' ');
  if (!token) return null;

  return type === 'Bearer' ? token : null;
}
