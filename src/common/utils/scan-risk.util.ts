import { isGtinShape, isIsbn13Shape } from './code-catalog.util';

export type ScanObservation = {
  createdAt: Date;
  city?: string | null;
  country?: string | null;
  deviceHash?: string | null;
};

export type CloneAssessment = {
  suspected: boolean;
  burst: boolean;
  multiCountry: boolean;
  scatter: boolean;
  cities: number;
  countries: number;
  devices: number;
};

const WEEK_MS = 7 * 86_400_000;
const BURST_MS = 10 * 60_000;

export function detectCredentialCloning(
  scans: ScanObservation[],
  now = new Date(),
): CloneAssessment {
  const week = scans.filter(
    (scan) => now.getTime() - scan.createdAt.getTime() < WEEK_MS,
  );
  const burstWindow = scans.filter(
    (scan) => now.getTime() - scan.createdAt.getTime() < BURST_MS,
  );
  const cities = new Set(
    week.map((scan) => scan.city).filter((value): value is string => Boolean(value)),
  );
  const countries = new Set(
    week
      .map((scan) => scan.country)
      .filter((value): value is string => Boolean(value)),
  );
  const devices = new Set(
    week
      .map((scan) => scan.deviceHash)
      .filter((value): value is string => Boolean(value)),
  );
  const burst = burstWindow.length >= 5;
  const multiCountry = countries.size >= 3;
  const scatter = cities.size >= 4 && devices.size >= 3;
  return {
    suspected: burst || multiCountry || scatter,
    burst,
    multiCountry,
    scatter,
    cities: cities.size,
    countries: countries.size,
    devices: devices.size,
  };
}

export function isGtin(code: string) {
  return isGtinShape(code);
}

export function isIsbn13(code: string) {
  return isIsbn13Shape(code);
}
