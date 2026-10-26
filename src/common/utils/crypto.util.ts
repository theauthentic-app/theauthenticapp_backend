import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function publicId(prefix: string, bytes = 12): string {
  return `${prefix}_${randomBytes(bytes).toString('base64url')}`;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function normalizeCode(raw: string): string {
  return raw
    .trim()
    .replace(/^AUTHENTIC\s+/i, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function extractCode(raw: string): string {
  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/').filter(Boolean);
    const vIndex = parts.findIndex((p) => p.toLowerCase() === 'v');
    if (vIndex >= 0 && parts[vIndex + 1]) {
      return decodeURIComponent(parts[vIndex + 1]);
    }
  } catch {
    // not a URL
  }
  return raw;
}

export function signIdentity(input: {
  secret: string;
  publicId: string;
  serialNumber: string;
  variantSku: string;
  issuedAt: string;
}): string {
  return hmacSha256(
    input.secret,
    [input.publicId, input.serialNumber, input.variantSku, input.issuedAt].join(
      '|',
    ),
  );
}

export function verifyIdentitySignature(input: {
  secret: string;
  publicId: string;
  serialNumber: string;
  variantSku: string;
  issuedAt: string;
  signature: string;
}): boolean {
  const expected = signIdentity(input);
  return safeEqualHex(expected, input.signature);
}

export function serialNumber(length = 10): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function credentialHint(value: string): string {
  const normalized = normalizeCode(value);
  return normalized.slice(-4);
}
