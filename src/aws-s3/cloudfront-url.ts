export function cloudFrontBaseUrl(domain: string): string {
  const trimmed = domain.replace(/\/+$/, '');
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}
