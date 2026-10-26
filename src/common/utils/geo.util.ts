export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function isPlausibleTravel(km: number, hours: number): boolean {
  if (km < 25) return true;
  if (km > 1500 && hours < 36) return false;
  if (km > 400 && hours < 6) return false;
  return km <= 160 * Math.max(hours, 0.5);
}

export type TravelObservation = {
  latitude: number;
  longitude: number;
  at: Date;
  city?: string | null;
};

export function detectImpossibleTravel(
  previous: TravelObservation[],
  current: TravelObservation,
): { impossible: boolean; km: number; hours: number; from?: string } | null {
  const last = [...previous]
    .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
    .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  if (!last) return null;
  const km = haversineKm(
    last.latitude,
    last.longitude,
    current.latitude,
    current.longitude,
  );
  const hours = Math.abs(current.at.getTime() - last.at.getTime()) / 3_600_000;
  return {
    impossible: !isPlausibleTravel(km, hours),
    km,
    hours,
    from: last.city ?? undefined,
  };
}
