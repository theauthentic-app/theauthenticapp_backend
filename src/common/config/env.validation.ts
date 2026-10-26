import { z } from 'zod';

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
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_PUBLIC_KEY: z.string().optional(),
  ORG_KYC_REQUIRED: z.string().optional(),
  EMAIL_PROVIDER: z.string().optional(),
  STORAGE_PROVIDER: z.string().optional(),
});

export function validateEnv(config: Record<string, unknown>) {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  return { ...config, ...parsed.data };
}
