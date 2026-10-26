export type TrustSignal =
  | 'VALID_CREDENTIAL'
  | 'VALID_SIGNATURE'
  | 'IDENTITY_ACTIVE'
  | 'KNOWN_MANUFACTURER'
  | 'BRAND_VERIFIED'
  | 'BATCH_ACTIVE'
  | 'NOT_RECALLED'
  | 'NOT_EXPIRED'
  | 'NO_DUPLICATE'
  | 'GEO_CONSISTENT'
  | 'NORMAL_FREQUENCY';

export const DEFAULT_TRUST_WEIGHTS: Record<TrustSignal, number> = {
  VALID_CREDENTIAL: 12,
  VALID_SIGNATURE: 16,
  IDENTITY_ACTIVE: 14,
  KNOWN_MANUFACTURER: 8,
  BRAND_VERIFIED: 8,
  BATCH_ACTIVE: 8,
  NOT_RECALLED: 10,
  NOT_EXPIRED: 6,
  NO_DUPLICATE: 8,
  GEO_CONSISTENT: 6,
  NORMAL_FREQUENCY: 4,
};

export type TrustEvaluation = {
  score: number;
  granted: TrustSignal[];
  denied: TrustSignal[];
};

export function calculateTrustScore(
  outcomes: Partial<Record<TrustSignal, boolean>>,
  weights: Record<TrustSignal, number> = DEFAULT_TRUST_WEIGHTS,
): TrustEvaluation {
  let score = 0;
  const granted: TrustSignal[] = [];
  const denied: TrustSignal[] = [];
  (Object.keys(weights) as TrustSignal[]).forEach((signal) => {
    if (outcomes[signal]) {
      score += weights[signal];
      granted.push(signal);
    } else {
      denied.push(signal);
    }
  });
  return {
    score: Math.max(0, Math.min(100, score)),
    granted,
    denied,
  };
}
