import { extractApiKey } from './api-key.auth';
import type { Request } from 'express';

function req(headers: Record<string, string>): Request {
  return { headers } as unknown as Request;
}

describe('extractApiKey', () => {
  it('reads X-API-Key and Bearer atk_live_ tokens', () => {
    expect(
      extractApiKey(req({ 'x-api-key': 'atk_live_abc' })),
    ).toBe('atk_live_abc');
    expect(
      extractApiKey(req({ authorization: 'Bearer atk_live_xyz' })),
    ).toBe('atk_live_xyz');
    expect(extractApiKey(req({ authorization: 'Bearer jwt.token' }))).toBe(
      undefined,
    );
  });
});
