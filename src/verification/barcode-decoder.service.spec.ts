import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { CredentialType } from '@prisma/client';
import {
  BarcodeDecoderService,
  mapZxingFormat,
  pickBestSymbol,
} from './barcode-decoder.service';

describe('barcode decoder helpers', () => {
  it('maps ZXing formats onto credential types', () => {
    expect(mapZxingFormat('QRCode')).toBe(CredentialType.QR);
    expect(mapZxingFormat('DataMatrix')).toBe(CredentialType.DATA_MATRIX);
    expect(mapZxingFormat('ISBN')).toBe(CredentialType.ISBN);
    expect(mapZxingFormat('EAN13')).toBe(CredentialType.BARCODE);
    expect(mapZxingFormat('Code128')).toBe(CredentialType.BARCODE);
  });

  it('prefers AUTHENTIC QR identities over retail barcodes', () => {
    const best = pickBestSymbol([
      {
        text: '9780141036144',
        format: 'EAN13',
        credentialType: CredentialType.BARCODE,
      },
      {
        text: 'pid_demoR8K2M19X',
        format: 'QRCode',
        credentialType: CredentialType.QR,
      },
    ]);
    expect(best?.text).toBe('pid_demoR8K2M19X');
  });
});

describe('BarcodeDecoderService', () => {
  it('decodes a generated EAN-13 ISBN barcode', async () => {
    const req = createRequire(__filename);
    const zxing = req('zxing-wasm/full') as {
      prepareZXingModule: (opts: unknown) => Promise<unknown> | void;
      writeBarcode: (
        text: string,
        opts: { format: string; scale: number },
      ) => Promise<{ image: Blob }>;
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
    const written = await zxing.writeBarcode('9780141036144', {
      format: 'EAN13',
      scale: 4,
    });
    const png = Buffer.from(await written.image.arrayBuffer());
    const decoder = new BarcodeDecoderService();
    const symbols = await decoder.decode(png, 'image/png');
    const texts = symbols.map((symbol) => symbol.text).join(',');
    expect(texts).toContain('9780141036144');
  }, 20000);
});
