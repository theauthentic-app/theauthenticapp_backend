import { z } from 'zod';

/** Render and dotenv often set unused keys to "", which should mean "not configured". */
function optionalMatching(pattern: RegExp, message: string) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().regex(pattern, message).optional(),
  );
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().optional(),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET is too short'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET is too short'),
  IDENTITY_SIGNING_SECRET: z
    .string()
    .min(16, 'IDENTITY_SIGNING_SECRET is too short'),
  REDIS_URL: z.string().optional(),
  SWAGGER_ENABLED: z.string().optional(),
  THROTTLE_PUBLIC: z.coerce.number().optional(),
  THROTTLE_JWT: z.coerce.number().optional(),
  THROTTLE_API_KEY: z.coerce.number().optional(),
  PAYSTACK_SECRET_KEY: optionalMatching(
    /^sk_(test|live)_\w+$/,
    'must look like sk_test_… or sk_live_…',
  ),
  PAYSTACK_PUBLIC_KEY: optionalMatching(
    /^pk_(test|live)_\w+$/,
    'must look like pk_test_… or pk_live_…',
  ),
  /** Extra comma-separated origins allowed as Paystack return URLs. */
  BILLING_CALLBACK_ORIGINS: z.string().optional(),
  ORG_KYC_REQUIRED: z.string().optional(),
  EMAIL_PROVIDER: z.string().optional(),
  STORAGE_PROVIDER: z.string().optional(),
  EMAIL_VERIFICATION_REQUIRED: z.string().optional(),
  /** true|false — when unset: debug tokens only if NODE_ENV!==production or EMAIL_PROVIDER=log */
  AUTH_DEBUG_TOKENS: z.string().optional(),
  BLOCKCHAIN_ENABLED: z.string().optional(),
  BLOCKCHAIN_CHAIN_KEY: z.string().optional(),
  BLOCKCHAIN_RPC_URL: z.string().optional(),
  BLOCKCHAIN_PRIVATE_KEY: z.string().optional(),
  BLOCKCHAIN_REGISTRY_ADDRESS: z.string().optional(),
});

const PLACEHOLDER_SECRET = /replace-with|changeme|dev-identity-hmac|^secret$/i;

function paystackIssues(env: z.infer<typeof envSchema>): string[] {
  const secret = env.PAYSTACK_SECRET_KEY;
  const publicKey = env.PAYSTACK_PUBLIC_KEY;
  if (!secret || !publicKey) return [];
  const secretMode = secret.startsWith('sk_live_') ? 'live' : 'test';
  const publicMode = publicKey.startsWith('pk_live_') ? 'live' : 'test';
  return secretMode === publicMode
    ? []
    : [
        `PAYSTACK_PUBLIC_KEY: is a ${publicMode} key but PAYSTACK_SECRET_KEY is ${secretMode}`,
      ];
}

function productionIssues(env: z.infer<typeof envSchema>): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const issues: string[] = [];
  for (const key of [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'IDENTITY_SIGNING_SECRET',
  ] as const) {
    const value = env[key];
    if (value.length < 32) issues.push(`${key}: must be at least 32 characters in production`);
    if (PLACEHOLDER_SECRET.test(value)) issues.push(`${key}: still a placeholder value`);
  }
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    issues.push('JWT_REFRESH_SECRET: must differ from JWT_ACCESS_SECRET');
  }
  return issues;
}

export function validateEnv(config: Record<string, unknown>) {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  const issues = [
    ...paystackIssues(parsed.data),
    ...productionIssues(parsed.data),
  ];
  if (issues.length) {
    throw new Error(`Invalid environment: ${issues.join('; ')}`);
  }
  return { ...config, ...parsed.data };
}
