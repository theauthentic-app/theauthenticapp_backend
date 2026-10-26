import type { Request } from 'express';

export function extractApiKey(request: Request): string | undefined {
  const header = request.headers['x-api-key'];
  if (typeof header === 'string' && header.startsWith('atk_live_')) {
    return header.trim();
  }
  const auth = request.headers.authorization;
  if (
    typeof auth === 'string' &&
    auth.toLowerCase().startsWith('bearer atk_live_')
  ) {
    return auth.slice(7).trim();
  }
  return undefined;
}
