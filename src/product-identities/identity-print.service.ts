import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class IdentityPrintService {
  constructor(private readonly prisma: PrismaService) {}

  verifyUrl(publicId: string) {
    const web = process.env.APP_WEB_URL ?? 'http://localhost:3001';
    return `${web.replace(/\/$/, '')}/scan?code=${encodeURIComponent(publicId)}`;
  }

  async labelPng(organizationId: string, identityPublicId: string) {
    const identity = await this.requireIdentity(organizationId, identityPublicId);
    return QRCode.toBuffer(this.verifyUrl(identity.publicId), {
      type: 'png',
      width: 512,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
  }

  async exportCsv(organizationId: string, batchPublicId?: string) {
    const identities = await this.listForExport(organizationId, batchPublicId);
    const header = [
      'publicId',
      'serialNumber',
      'status',
      'product',
      'batch',
      'verifyUrl',
      'labelUrl',
    ];
    const api = process.env.API_BASE_URL ?? 'http://localhost:3001';
    const rows = identities.map((row) =>
      [
        row.publicId,
        row.serialNumber,
        row.status,
        row.productVariant.product.name,
        row.batch.batchNumber,
        this.verifyUrl(row.publicId),
        `${api}/api/v1/product-identities/${row.publicId}/label`,
      ]
        .map((value) => csvCell(String(value)))
        .join(','),
    );
    return [header.join(','), ...rows].join('\n') + '\n';
  }

  async exportPdf(organizationId: string, batchPublicId?: string) {
    const identities = await this.listForExport(organizationId, batchPublicId);
    if (identities.length > 500) {
      throw new AppError(
        'EXPORT_TOO_LARGE',
        'PDF export is limited to 500 identities. Use CSV for larger batches.',
        400,
      );
    }
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    doc.fontSize(16).text('AUTHENTIC identity pack', { align: 'left' });
    doc.fontSize(10).fillColor('#555').text(`${identities.length} labels`);
    doc.moveDown();

    const cell = 170;
    let x = 36;
    let y = 90;
    for (const identity of identities) {
      const png = await QRCode.toBuffer(this.verifyUrl(identity.publicId), {
        type: 'png',
        width: 220,
        margin: 1,
      });
      if (y + cell > 780) {
        doc.addPage();
        x = 36;
        y = 36;
      }
      doc.image(png, x, y, { width: 110, height: 110 });
      doc
        .fillColor('#111')
        .fontSize(8)
        .text(identity.publicId, x, y + 114, { width: 150 });
      doc
        .fillColor('#444')
        .fontSize(8)
        .text(identity.serialNumber, x, y + 126, { width: 150 });
      x += cell;
      if (x > 420) {
        x = 36;
        y += cell;
      }
    }
    doc.end();
    return done;
  }

  private async listForExport(organizationId: string, batchPublicId?: string) {
    return this.prisma.productIdentity.findMany({
      where: {
        organizationId,
        ...(batchPublicId ? { batch: { publicId: batchPublicId } } : {}),
      },
      include: {
        productVariant: { include: { product: true } },
        batch: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 5000,
    });
  }

  private async requireIdentity(organizationId: string, publicId: string) {
    const identity = await this.prisma.productIdentity.findFirst({
      where: { organizationId, publicId },
    });
    if (!identity) {
      throw new AppError('IDENTITY_NOT_FOUND', 'Product identity not found.', 404);
    }
    return identity;
  }
}

function csvCell(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
