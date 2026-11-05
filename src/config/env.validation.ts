const REQUIRED_KEYS = [
  'MONGODB_URI',
  'JWT_SECRET',
  'OTP_SECRET',
  'FRONTEND_URI',
  'GOOGLE_CLIENT_ID',
  'EMAIL_HOST',
  'EMAIL_PORT',
  'EMAIL_USER',
  'EMAIL_PASS',
  'AWS_BUCKET_NAME',
  'AWS_REGION',
  'MY_AWS_ACCESS_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'CLOUDFRONT_DOMAIN_NAME',
  'STRIPE_API_KEY',
  'STRIPE_WEBHOOK_SECRET',
] as const;

function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainOrigin(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return (
      (protocol === 'http:' || protocol === 'https:') && !value.endsWith('/')
    );
  } catch {
    return false;
  }
}

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const problems: string[] = [];

  for (const key of REQUIRED_KEYS) {
    if (!isFilled(config[key])) {
      problems.push(`${key} is missing or empty`);
    }
  }

  const origin = config.FRONTEND_URI;
  if (isFilled(origin) && !isPlainOrigin(origin)) {
    problems.push(
      'FRONTEND_URI must be an http(s) URL without a trailing slash',
    );
  }

  const port = config.EMAIL_PORT;
  if (isFilled(port) && !Number.isInteger(Number(port))) {
    problems.push('EMAIL_PORT must be a whole number');
  }

  if (problems.length > 0) {
    throw new Error(`Invalid environment: ${problems.join('; ')}`);
  }

  return config;
}
