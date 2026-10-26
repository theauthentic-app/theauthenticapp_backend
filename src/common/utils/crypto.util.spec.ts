import {
  normalizeCode,
  signIdentity,
  verifyIdentitySignature,
} from './crypto.util';

describe('identity crypto', () => {
  it('normalizes codes consistently', () => {
    expect(normalizeCode(' authentic  ax92819 ')).toBe('AX92819');
  });

  it('round-trips a product identity signature', () => {
    const payload = {
      secret: 'test-secret',
      publicId: 'pid_abc',
      serialNumber: 'A7X82K19',
      variantSku: 'MT-PARA-500',
      issuedAt: '2026-06-12T08:00:00.000Z',
    };
    const signature = signIdentity(payload);
    expect(verifyIdentitySignature({ ...payload, signature })).toBe(true);
    expect(
      verifyIdentitySignature({ ...payload, signature: '00'.repeat(32) }),
    ).toBe(false);
  });
});
