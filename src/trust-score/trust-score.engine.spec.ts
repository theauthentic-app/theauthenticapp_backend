import { calculateTrustScore } from './trust-score.engine';

describe('trust score engine', () => {
  it('scores a fully evidenced identity near 100', () => {
    const result = calculateTrustScore({
      VALID_CREDENTIAL: true,
      VALID_SIGNATURE: true,
      IDENTITY_ACTIVE: true,
      KNOWN_MANUFACTURER: true,
      BRAND_VERIFIED: true,
      BATCH_ACTIVE: true,
      NOT_RECALLED: true,
      NOT_EXPIRED: true,
      NO_DUPLICATE: true,
      GEO_CONSISTENT: true,
      NORMAL_FREQUENCY: true,
    });
    expect(result.score).toBe(100);
    expect(result.denied).toHaveLength(0);
  });

  it('drops score when signature and geography fail', () => {
    const result = calculateTrustScore({
      VALID_CREDENTIAL: true,
      VALID_SIGNATURE: false,
      IDENTITY_ACTIVE: true,
      GEO_CONSISTENT: false,
    });
    expect(result.score).toBeLessThan(80);
    expect(result.denied).toContain('VALID_SIGNATURE');
  });
});
