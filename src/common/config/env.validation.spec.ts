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
