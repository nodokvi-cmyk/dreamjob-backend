import type { Response } from 'express';

const PUBLIC_CACHE_CONTROL =
  'public, max-age=0, s-maxage=60, stale-while-revalidate=300';

export async function withPublicCache<T>(
  response: Response,
  load: () => Promise<T>,
): Promise<T> {
  const result = await load();
  response.setHeader('Cache-Control', PUBLIC_CACHE_CONTROL);

  return result;
}
