import {
  isbn10ToIsbn13,
  isValidGtin,
  isValidIsbn10,
  isValidIsbn13,
  parsePresentedCode,
} from './code-catalog.util';

describe('code catalog', () => {
  it('validates ISBN-10 and converts to ISBN-13', () => {
    expect(isValidIsbn10('0-306-40615-2')).toBe(true);
    expect(isbn10ToIsbn13('0306406152')).toBe('9780306406157');
    expect(isValidIsbn13('9780306406157')).toBe(true);
  });

  it('validates ISBN-13 checksums and rejects bad ones', () => {
    expect(isValidIsbn13('9780141036144')).toBe(true);
    expect(isValidIsbn13('978-0-14-103614-4')).toBe(true);
    expect(isValidIsbn13('9780141036145')).toBe(false);
  });

  it('canonicalizes ISBN-10 scans to ISBN-13 candidates', () => {
    const parsed = parsePresentedCode('0-306-40615-2');
    expect(parsed.kind).toBe('isbn');
    expect(parsed.canonical).toBe('9780306406157');
    expect(parsed.isbn10).toBe('0306406152');
    expect(parsed.candidates).toEqual(
      expect.arrayContaining(['0306406152', '9780306406157']),
    );
  });

  it('validates GTIN/EAN/UPC check digits', () => {
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('12345670')).toBe(true);
    expect(isValidGtin('4006381333932')).toBe(false);
  });

  it('pads UPC-A to EAN-13 candidates', () => {
    const parsed = parsePresentedCode('036000291452');
    expect(parsed.kind).toBe('gtin');
    expect(parsed.checksumValid).toBe(true);
    expect(parsed.candidates).toEqual(
      expect.arrayContaining(['036000291452', '0036000291452']),
    );
  });

  it('keeps AUTHENTIC QR and serial codes unchanged', () => {
    expect(parsePresentedCode('pid_demoR8K2M19X').kind).toBe('qr');
      expect(parsePresentedCode('pid_demoR8K2M19X').canonical).toBe(
      'PID_DEMOR8K2M19X',
    );
    expect(parsePresentedCode('A7X82K29').kind).toBe('serial');
  });
});
