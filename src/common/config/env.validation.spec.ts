import { validateEnv } from './env.validation';

const strong = (c: string) => c.repeat(40);

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: strong('a'),
  JWT_REFRESH_SECRET: strong('b'),
  IDENTITY_SIGNING_SECRET: strong('c'),
};

describe('validateEnv', () => {
  it('accepts strong secrets in production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).not.toThrow();
  });

  it('allows short dev secrets outside production', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'development',
        JWT_ACCESS_SECRET: 'sixteen-chars-ok',
      }),
    ).not.toThrow();
  });

  it('rejects short secrets in production', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'sixteen-chars-ok',
      }),
    ).toThrow(/JWT_ACCESS_SECRET: must be at least 32/);
  });

  it('rejects placeholder secrets in production', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_REFRESH_SECRET: 'replace-with-a-long-random-refresh-secret',
      }),
    ).toThrow(/JWT_REFRESH_SECRET: still a placeholder/);
  });

  it('treats empty Paystack keys as not configured', () => {
    expect(() =>
      validateEnv({ ...base, PAYSTACK_SECRET_KEY: '', PAYSTACK_PUBLIC_KEY: '' }),
    ).not.toThrow();
  });

  it('rejects a malformed Paystack secret key', () => {
    expect(() =>
      validateEnv({ ...base, PAYSTACK_SECRET_KEY: 'pk_test_swapped' }),
    ).toThrow(/PAYSTACK_SECRET_KEY: must look like sk_/);
  });

  it('rejects mixing test and live Paystack keys', () => {
    expect(() =>
      validateEnv({
        ...base,
        PAYSTACK_SECRET_KEY: 'sk_live_abc',
        PAYSTACK_PUBLIC_KEY: 'pk_test_abc',
      }),
    ).toThrow(/is a test key but PAYSTACK_SECRET_KEY is live/);
  });

  it('rejects identical access and refresh secrets in production', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET,
      }),
    ).toThrow(/must differ/);
  });
});
