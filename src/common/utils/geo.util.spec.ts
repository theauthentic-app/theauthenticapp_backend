import {
  detectImpossibleTravel,
  haversineKm,
  isPlausibleTravel,
} from './geo.util';

describe('geo', () => {
  it('measures Lagos to London as a transcontinental distance', () => {
    const km = haversineKm(6.5244, 3.3792, 51.5074, -0.1278);
    expect(km).toBeGreaterThan(4000);
  });

  it('rejects impossible travel', () => {
    expect(isPlausibleTravel(5000, 0.1)).toBe(false);
    expect(isPlausibleTravel(12, 0.2)).toBe(true);
  });

  it('flags Lagos then London seven minutes later', () => {
    const result = detectImpossibleTravel(
      [
        {
          latitude: 6.5244,
          longitude: 3.3792,
          at: new Date('2026-09-09T10:00:00Z'),
          city: 'Lagos',
        },
      ],
      {
        latitude: 51.5074,
        longitude: -0.1278,
        at: new Date('2026-09-09T10:07:00Z'),
        city: 'London',
      },
    );
    expect(result?.impossible).toBe(true);
  });
});
