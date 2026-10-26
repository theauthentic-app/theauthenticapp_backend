import { extractCode, normalizeCode } from './crypto.util';

export type CodeKind =
  | 'isbn'
  | 'gtin'
  | 'qr'
  | 'serial'
  | 'security_code'
  | 'nfc'
  | 'rfid'
  | 'unknown';

export type PresentedCode = {
  original: string;
  canonical: string;
  kind: CodeKind;
  checksumValid: boolean | null;
  candidates: string[];
  isbn10?: string;
  isbn13?: string;
  gtin?: string;
};

export function compactDigitsAndX(raw: string): string {
  return raw.replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function isbn10ChecksumDigit(body9: string): string {
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += Number(body9[i]) * (10 - i);
  }
  const remainder = (11 - (sum % 11)) % 11;
  return remainder === 10 ? 'X' : String(remainder);
}

export function isValidIsbn10(code: string): boolean {
  const compact = compactDigitsAndX(code);
  if (!/^\d{9}[\dX]$/.test(compact)) return false;
  return isbn10ChecksumDigit(compact.slice(0, 9)) === compact[9];
}

export function gtinCheckDigit(body: string): string {
  const digits = body.split('').map(Number).reverse();
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    sum += digits[i] * (i % 2 === 0 ? 3 : 1);
  }
  return String((10 - (sum % 10)) % 10);
}

export function isValidGtin(code: string): boolean {
  const compact = compactDigitsAndX(code);
  if (!/^\d{8}$/.test(compact) && !/^\d{12,14}$/.test(compact)) return false;
  return gtinCheckDigit(compact.slice(0, -1)) === compact.slice(-1);
}

export function isbn13ChecksumDigit(body12: string): string {
  return gtinCheckDigit(body12);
}

export function isValidIsbn13(code: string): boolean {
  const compact = compactDigitsAndX(code);
  if (!/^(978|979)\d{10}$/.test(compact)) return false;
  return isbn13ChecksumDigit(compact.slice(0, 12)) === compact[12];
}

export function isbn10ToIsbn13(isbn10: string): string | null {
  const compact = compactDigitsAndX(isbn10);
  if (!isValidIsbn10(compact)) return null;
  const body = `978${compact.slice(0, 9)}`;
  return `${body}${isbn13ChecksumDigit(body)}`;
}

export function isbn13ToIsbn10(isbn13: string): string | null {
  const compact = compactDigitsAndX(isbn13);
  if (!/^978\d{10}$/.test(compact) || !isValidIsbn13(compact)) return null;
  const body9 = compact.slice(3, 12);
  return `${body9}${isbn10ChecksumDigit(body9)}`;
}

export function isIsbn13Shape(code: string): boolean {
  return /^(978|979)\d{10}$/.test(compactDigitsAndX(code));
}

export function isGtinShape(code: string): boolean {
  const compact = compactDigitsAndX(code);
  return /^\d{8}$/.test(compact) || /^\d{12,14}$/.test(compact);
}

export function gtinCandidates(code: string): string[] {
  const compact = compactDigitsAndX(code);
  if (!/^\d+$/.test(compact)) return [];
  const out = new Set<string>();
  const consider = [compact];
  if (compact.length === 12) consider.push(`0${compact}`);
  if (compact.length === 13 && compact.startsWith('0')) {
    consider.push(compact.slice(1));
  }
  if (compact.length === 14 && compact.startsWith('0')) {
    consider.push(compact.slice(1));
  }
  if (compact.length === 13) consider.push(`0${compact}`);
  for (const value of consider) {
    if (isValidGtin(value) || isGtinShape(value)) out.add(value);
  }
  return [...out];
}

function unique(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function parsePresentedCode(raw: string): PresentedCode {
  const original = raw.trim();
  const extracted = extractCode(original);
  const normalized = normalizeCode(extracted);
  const compact = compactDigitsAndX(extracted);
  const candidates = new Set<string>([normalized, extracted.trim()]);

  if (normalized.startsWith('PID_')) {
    return {
      original,
      canonical: normalized,
      kind: 'qr',
      checksumValid: null,
      candidates: unique([normalized]),
    };
  }
  if (normalized.startsWith('SC-')) {
    return {
      original,
      canonical: normalized,
      kind: 'security_code',
      checksumValid: null,
      candidates: unique([normalized]),
    };
  }
  if (normalized.startsWith('NFC-')) {
    return {
      original,
      canonical: normalized,
      kind: 'nfc',
      checksumValid: null,
      candidates: unique([normalized]),
    };
  }
  if (normalized.startsWith('RFID-')) {
    return {
      original,
      canonical: normalized,
      kind: 'rfid',
      checksumValid: null,
      candidates: unique([normalized]),
    };
  }

  if (isValidIsbn10(compact) || isValidIsbn13(compact) || isIsbn13Shape(compact)) {
    const isbn13 = isValidIsbn10(compact)
      ? isbn10ToIsbn13(compact)
      : compact.length === 13
        ? compact
        : undefined;
    const isbn10 = isValidIsbn10(compact)
      ? compact
      : isbn13
        ? isbn13ToIsbn10(isbn13) ?? undefined
        : undefined;
    const canonical = isbn13 ?? compact;
    for (const value of [compact, isbn10, isbn13, normalized]) {
      if (value) candidates.add(value);
    }
    return {
      original,
      canonical,
      kind: 'isbn',
      checksumValid: isValidIsbn10(compact) || isValidIsbn13(compact),
      candidates: unique([...candidates]),
      isbn10,
      isbn13: isbn13 ?? undefined,
    };
  }

  if (isGtinShape(compact)) {
    const variants = gtinCandidates(compact);
    for (const value of variants) candidates.add(value);
    const canonical =
      variants.find((value) => isValidGtin(value)) ?? compact;
    return {
      original,
      canonical,
      kind: 'gtin',
      checksumValid: isValidGtin(compact) || variants.some((value) => isValidGtin(value)),
      candidates: unique([...candidates, compact]),
      gtin: canonical,
    };
  }

  if (/^[A-HJ-NP-Z2-9]{8,16}$/.test(normalized)) {
    return {
      original,
      canonical: normalized,
      kind: 'serial',
      checksumValid: null,
      candidates: unique([normalized]),
    };
  }

  return {
    original,
    canonical: normalized,
    kind: 'unknown',
    checksumValid: null,
    candidates: unique([normalized, compact || undefined]),
  };
}

export function normalizeProductCode(
  raw: string | undefined,
  kind: 'gtin' | 'isbn',
): string | undefined {
  if (!raw?.trim()) return undefined;
  const parsed = parsePresentedCode(raw);
  if (kind === 'isbn') {
    if (parsed.kind !== 'isbn' || parsed.checksumValid === false) {
      return undefined;
    }
    return parsed.isbn13 ?? parsed.canonical;
  }
  if (parsed.kind !== 'gtin' || parsed.checksumValid === false) {
    return undefined;
  }
  return parsed.gtin ?? parsed.canonical;
}
