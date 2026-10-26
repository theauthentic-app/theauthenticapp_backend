import {
  detectCredentialCloning,
  isGtin,
  isIsbn13,
} from './scan-risk.util';

describe('scan-risk', () => {
  it('flags multi-country circulation as cloning', () => {
    const now = new Date('2026-09-10T12:00:00Z');
    const result = detectCredentialCloning(
      [
        {
          createdAt: new Date('2026-09-09T10:00:00Z'),
          country: 'NG',
          city: 'Lagos',
          deviceHash: 'a',
        },
        {
          createdAt: new Date('2026-09-09T18:00:00Z'),
          country: 'GH',
          city: 'Accra',
          deviceHash: 'b',
        },
        {
          createdAt: new Date('2026-09-10T08:00:00Z'),
          country: 'KE',
          city: 'Nairobi',
          deviceHash: 'c',
        },
      ],
      now,
    );
    expect(result.multiCountry).toBe(true);
    expect(result.suspected).toBe(true);
  });

  it('flags a 10-minute burst', () => {
    const now = new Date('2026-09-10T12:00:00Z');
    const scans = Array.from({ length: 5 }).map((_, i) => ({
      createdAt: new Date(now.getTime() - i * 60_000),
      deviceHash: `d${i}`,
    }));
    expect(detectCredentialCloning(scans, now).burst).toBe(true);
  });

  it('recognizes GTIN and ISBN shapes', () => {
    expect(isGtin('6151234567890')).toBe(true);
    expect(isIsbn13('9780141036144')).toBe(true);
    expect(isIsbn13('6151234567890')).toBe(false);
    expect(isGtin('pid_demo')).toBe(false);
  });
});
