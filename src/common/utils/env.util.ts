export function env(key: string, fallback?: string): string | undefined {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return fallback;
  }
  return value;
}
