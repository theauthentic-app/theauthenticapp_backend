import { Injectable, Logger } from '@nestjs/common';
import { CredentialType } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { AppError } from '../common/errors/app-error';
import { parsePresentedCode } from '../common/utils/code-catalog.util';

const ALLOWED = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
]);
const MAX_BYTES = 8 * 1024 * 1024;

export type DecodedSymbol = {
  text: string;
  format: string;
  credentialType: CredentialType;
};

const FORMAT_TO_CREDENTIAL: Record<string, CredentialType> = {
  QRCode: CredentialType.QR,
  QRCodeModel1: CredentialType.QR,
  QRCodeModel2: CredentialType.QR,
  MicroQRCode: CredentialType.QR,
  RMQRCode: CredentialType.QR,
  DataMatrix: CredentialType.DATA_MATRIX,
  ISBN: CredentialType.ISBN,
};

export function mapZxingFormat(format: string): CredentialType {
  return FORMAT_TO_CREDENTIAL[format] ?? CredentialType.BARCODE;
}

export function pickBestSymbol(symbols: DecodedSymbol[]): DecodedSymbol | null {
  if (symbols.length === 0) return null;
  const ranked = [...symbols].sort((left, right) => {
    return rankSymbol(left) - rankSymbol(right);
  });
  return ranked[0] ?? null;
}

function rankSymbol(symbol: DecodedSymbol): number {
  const parsed = parsePresentedCode(symbol.text);
  const kindRank: Record<string, number> = {
    qr: 0,
    security_code: 1,
    nfc: 2,
    rfid: 3,
    serial: 4,
    isbn: 5,
    gtin: 6,
    unknown: 7,
  };
  return kindRank[parsed.kind] ?? 8;
}

type ZxingInput =
  | Uint8Array
  | {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      colorSpace: 'srgb';
    };

type ZxingReader = {
  readBarcodes: (
    input: ZxingInput,
    options?: {
      tryHarder?: boolean;
      tryRotate?: boolean;
      tryInvert?: boolean;
      maxNumberOfSymbols?: number;
    },
  ) => Promise<Array<{ text?: string; format?: string; isValid?: boolean }>>;
};

@Injectable()
export class BarcodeDecoderService {
  private readonly logger = new Logger(BarcodeDecoderService.name);
  private readerPromise: Promise<ZxingReader> | null = null;

  async decode(buffer: Buffer, mimeType?: string): Promise<DecodedSymbol[]> {
    if (mimeType && !ALLOWED.has(mimeType.toLowerCase())) {
      throw new AppError(
        'INVALID_FILE',
        'Upload a JPEG, PNG, WebP, GIF, or BMP image.',
        400,
      );
    }
    if (buffer.length > MAX_BYTES) {
      throw new AppError('FILE_TOO_LARGE', 'Image exceeds the 8MB limit.', 400);
    }
    if (buffer.length < 32) {
      throw new AppError(
        'INVALID_FILE',
        'The image file is empty or truncated.',
        400,
      );
    }

    const { data, info } = await sharp(buffer)
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({
        width: 2000,
        height: 2000,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = new Uint8ClampedArray(data.byteLength);
    pixels.set(data);
    const reader = await this.getReader();
    const options = {
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
      maxNumberOfSymbols: 8,
    };

    let results: Array<{ text?: string; format?: string; isValid?: boolean }> =
      [];
    try {
      results = await reader.readBarcodes(
        {
          data: pixels,
          width: info.width,
          height: info.height,
          colorSpace: 'srgb',
        },
        options,
      );
    } catch (error) {
      this.logger.debug(`Pixmap decode failed: ${String(error)}`);
    }
    if (results.length === 0) {
      try {
        const jpeg = await sharp(buffer).rotate().jpeg().toBuffer();
        results = await reader.readBarcodes(new Uint8Array(jpeg), options);
      } catch (error) {
        this.logger.debug(`JPEG decode failed: ${String(error)}`);
      }
    }

    const symbols: DecodedSymbol[] = [];
    const seen = new Set<string>();
    for (const result of results) {
      if (result.isValid === false || !result.text?.trim()) continue;
      const text = result.text.trim();
      const key = text.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      symbols.push({
        text,
        format: result.format ?? 'Unknown',
        credentialType: mapZxingFormat(result.format ?? ''),
      });
    }
    return symbols;
  }

  private getReader(): Promise<ZxingReader> {
    if (!this.readerPromise) {
      this.readerPromise = this.loadReader();
    }
    return this.readerPromise;
  }

  private async loadReader(): Promise<ZxingReader> {
    try {
      const req = createRequire(__filename);
      const zxing = req('zxing-wasm/full') as {
        prepareZXingModule: (opts: {
          fireImmediately?: boolean;
          overrides?: { wasmBinary?: Buffer };
        }) => Promise<unknown> | void;
        readBarcodes: ZxingReader['readBarcodes'];
      };
      const wasmPath = join(
        dirname(req.resolve('zxing-wasm/full')),
        '..',
        '..',
        'full',
        'zxing_full.wasm',
      );
      await zxing.prepareZXingModule({
        fireImmediately: true,
        overrides: { wasmBinary: readFileSync(wasmPath) },
      });
      return { readBarcodes: zxing.readBarcodes.bind(zxing) };
    } catch (error: unknown) {
      this.logger.error(`Failed to load barcode decoder: ${String(error)}`);
      throw new AppError(
        'DECODER_UNAVAILABLE',
        'The barcode decoder failed to start.',
        503,
      );
    }
  }
}
