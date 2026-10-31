import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CredentialType, IdentityStatus, Prisma } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import {
  parsePresentedCode,
} from '../common/utils/code-catalog.util';
import {
  credentialHint,
  normalizeCode,
  publicId,
  serialNumber,
  sha256,
  signIdentity,
} from '../common/utils/crypto.util';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RedisService } from '../redis/redis.service';
import {
  paginatedResult,
  paginationOf,
  type PaginationInput,
} from '../common/utils/pagination.util';
import { assertOrgWritable } from '../common/utils/org-status.util';

const ATTACHABLE_TYPES = new Set<CredentialType>([
  CredentialType.BARCODE,
  CredentialType.ISBN,
  CredentialType.DATA_MATRIX,
  CredentialType.NFC,
  CredentialType.RFID,
  CredentialType.SERIAL,
  CredentialType.QR,
  CredentialType.SECURITY_CODE,
  CredentialType.DIGITAL_SIGNATURE,
  CredentialType.OTHER,
]);

@Injectable()
export class ProductIdentitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly billing: BillingService,
    private readonly notifications: NotificationsService,
    private readonly blockchain: BlockchainService,
  ) {}

  async list(organizationId: string, query?: PaginationInput) {
    const { page, limit, skip, take } = paginationOf(query);
    const where = { organizationId };
    const [identities, total] = await this.prisma.$transaction([
      this.prisma.productIdentity.findMany({
        where,
        include: {
          productVariant: { include: { product: true } },
          batch: true,
          credentials: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.productIdentity.count({ where }),
    ]);
    return paginatedResult(
      identities.map((identity) => ({
        id: identity.publicId,
        serialNumber: identity.serialNumber,
        status: identity.status,
        productName: identity.productVariant.product.name,
        batchNumber: identity.batch.batchNumber,
        createdAt: identity.createdAt,
        credentials: identity.credentials.map((credential) => ({
          type: credential.type,
          hint: credential.valueHint,
          status: credential.status,
        })),
      })),
      total,
      page,
      limit,
    );
  }

  async generate(
    organizationId: string,
    actorUserId: string | undefined,
    input: {
      batchId: string;
      count: number;
      withSecurityCode?: boolean;
      withBarcode?: boolean;
      withDataMatrix?: boolean;
      withNfc?: boolean;
      withRfid?: boolean;
      manufacturerCodes?: Array<{ type: CredentialType; value: string }>;
    },
  ) {
    if (input.count < 1 || input.count > 100000) {
      throw new AppError(
        'INVALID_COUNT',
        'Count must be between 1 and 100000.',
        400,
      );
    }
    if ((input.manufacturerCodes?.length ?? 0) > 0 && input.count !== 1) {
      throw new AppError(
        'MANUFACTURER_CODE_COUNT',
        'Manufacturer barcodes, ISBNs, NFC, and RFID values can only be attached when generating a single identity. They must be unique per unit.',
        400,
      );
    }
    await this.billing.assertIdentityQuota(organizationId, input.count);
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (org) assertOrgWritable(org);
    const batch = await this.prisma.batch.findFirst({
      where: { publicId: input.batchId, organizationId },
      include: { productVariant: true },
    });
    if (!batch) throw new AppError('BATCH_NOT_FOUND', 'Batch not found.', 404);

    const secret = this.config.getOrThrow<string>('IDENTITY_SIGNING_SECRET');
    const created: Array<{
      id: string;
      publicId: string;
      serialNumber: string;
      signature: string;
      createdAt: Date;
    }> = [];
    const chunkSize = 250;

    for (let offset = 0; offset < input.count; offset += chunkSize) {
      const size = Math.min(chunkSize, input.count - offset);
      const rows = Array.from({ length: size }).map(() => ({
        serial: serialNumber(10),
        pid: publicId('pid'),
      }));

      await this.prisma.$transaction(async (tx) => {
        for (const row of rows) {
          const identity = await tx.productIdentity.create({
            data: {
              publicId: row.pid,
              serialNumber: row.serial,
              organizationId,
              productVariantId: batch.productVariantId,
              batchId: batch.id,
              status: IdentityStatus.ACTIVE,
              activatedAt: new Date(),
              signature: 'pending',
            },
          });
          const signature = signIdentity({
            secret,
            publicId: row.pid,
            serialNumber: row.serial,
            variantSku: batch.productVariant.sku,
            issuedAt: identity.createdAt.toISOString(),
          });
          await tx.productIdentity.update({
            where: { id: identity.id },
            data: { signature },
          });
          const extras = this.generatedChannelCredentials(
            identity.id,
            row,
            input,
          );
          try {
            await tx.credential.createMany({
              data: [
                {
                  publicId: publicId('crd'),
                  productIdentityId: identity.id,
                  type: CredentialType.SERIAL,
                  valueHash: sha256(normalizeCode(row.serial)),
                  valueHint: credentialHint(row.serial),
                },
                {
                  publicId: publicId('crd'),
                  productIdentityId: identity.id,
                  type: CredentialType.QR,
                  valueHash: sha256(normalizeCode(row.pid)),
                  valueHint: credentialHint(row.pid),
                },
                ...(input.withSecurityCode
                  ? [
                      {
                        publicId: publicId('crd'),
                        productIdentityId: identity.id,
                        type: CredentialType.SECURITY_CODE,
                        valueHash: sha256(normalizeCode(`SC-${row.serial}`)),
                        valueHint: credentialHint(`SC-${row.serial}`),
                      },
                    ]
                  : []),
                ...extras,
              ],
            });
            if (input.manufacturerCodes?.length) {
              for (const manufacturer of input.manufacturerCodes) {
                await this.insertCredential(tx, identity.id, manufacturer);
              }
            }
          } catch (error) {
            this.throwIfCredentialConflict(error);
            throw error;
          }
          created.push({
            id: identity.id,
            publicId: row.pid,
            serialNumber: row.serial,
            signature,
            createdAt: identity.createdAt,
          });
        }
      });
    }

    await this.audit.record({
      action: 'IDENTITY_GENERATED',
      actorUserId,
      organizationId,
      entity: 'ProductIdentity',
      metadata: { count: created.length, batchId: batch.publicId },
    });

    try {
      await this.blockchain.queueForIdentities(
        created.map((row) => ({
          id: row.id,
          publicId: row.publicId,
          signature: row.signature,
          organizationId,
          createdAt: row.createdAt,
        })),
      );
    } catch {
      // Anchoring is best-effort; mint must still succeed.
    }

    const snap = await this.billing.snapshot(organizationId);
    if (
      snap.remaining.identities != null &&
      snap.plan.identityQuota != null &&
      snap.plan.identityQuota > 0
    ) {
      const used = snap.usage.identities;
      const percent = Math.round((used / snap.plan.identityQuota) * 100);
      if (percent >= 80) {
        this.notifications.notifyOrganizationSafe(organizationId, {
          subject: `Identity quota at ${percent}%`,
          template: 'quota-warning',
          context: {
            planName: snap.plan.name,
            used,
            quota: snap.plan.identityQuota,
            remaining: snap.remaining.identities,
            percent,
          },
          onceKey: `mail:quota:${organizationId}:${snap.currentPeriodStart.toISOString().slice(0, 10)}`,
          onceTtlSeconds: 7 * 86_400,
        });
      }
    }

    const web = process.env.APP_WEB_URL ?? 'http://localhost:3001';
    const api = process.env.API_BASE_URL ?? 'http://localhost:3001';
    return {
      count: created.length,
      identities: created.slice(0, 25).map((row) => ({
        publicId: row.publicId,
        serialNumber: row.serialNumber,
        verifyUrl: `${web.replace(/\/$/, '')}/scan?code=${encodeURIComponent(row.publicId)}`,
        labelUrl: `${api.replace(/\/$/, '')}/api/v1/product-identities/${row.publicId}/label`,
        blockchainUrl: `${api.replace(/\/$/, '')}/api/v1/public/identities/${row.publicId}/blockchain`,
      })),
      truncated: created.length > 25,
      blockchain: this.blockchain.status(),
      export: {
        csv: `${api.replace(/\/$/, '')}/api/v1/product-identities/export?format=csv&batchId=${batch.publicId}`,
        pdf: `${api.replace(/\/$/, '')}/api/v1/product-identities/export?format=pdf&batchId=${batch.publicId}`,
      },
    };
  }

  async activate(
    organizationId: string,
    actorUserId: string | undefined,
    identityPublicId: string,
  ) {
    const identity = await this.prisma.productIdentity.findFirst({
      where: { publicId: identityPublicId, organizationId },
    });
    if (!identity)
      throw new AppError(
        'IDENTITY_NOT_FOUND',
        'Product identity not found.',
        404,
      );
    const updated = await this.prisma.productIdentity.update({
      where: { id: identity.id },
      data: { status: IdentityStatus.ACTIVE, activatedAt: new Date() },
    });
    await this.invalidateIdentityCache(updated.publicId);
    await this.audit.record({
      action: 'IDENTITY_ACTIVATED',
      actorUserId,
      organizationId,
      entity: 'ProductIdentity',
      entityId: identity.id,
    });
    return { id: updated.publicId, status: updated.status };
  }

  async revoke(
    organizationId: string,
    actorUserId: string | undefined,
    identityPublicId: string,
  ) {
    const identity = await this.prisma.productIdentity.findFirst({
      where: { publicId: identityPublicId, organizationId },
    });
    if (!identity)
      throw new AppError(
        'IDENTITY_NOT_FOUND',
        'Product identity not found.',
        404,
      );
    const updated = await this.prisma.productIdentity.update({
      where: { id: identity.id },
      data: { status: IdentityStatus.REVOKED, revokedAt: new Date() },
    });
    await this.prisma.credential.updateMany({
      where: { productIdentityId: identity.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    await this.invalidateIdentityCache(updated.publicId);
    await this.audit.record({
      action: 'IDENTITY_REVOKED',
      actorUserId,
      organizationId,
      entity: 'ProductIdentity',
      entityId: identity.id,
    });
    return { id: updated.publicId, status: updated.status };
  }

  async attachCredential(
    organizationId: string,
    actorUserId: string | undefined,
    input: { identityId: string; type: CredentialType; value: string },
  ) {
    if (!ATTACHABLE_TYPES.has(input.type)) {
      throw new AppError(
        'UNSUPPORTED_CREDENTIAL',
        'That credential type cannot be attached.',
        400,
      );
    }
    const identity = await this.prisma.productIdentity.findFirst({
      where: { publicId: input.identityId, organizationId },
    });
    if (!identity) {
      throw new AppError(
        'IDENTITY_NOT_FOUND',
        'Product identity not found.',
        404,
      );
    }
    try {
      const credential = await this.prisma.credential.create({
        data: this.credentialRecord(identity.id, input.type, input.value),
      });
      await this.invalidateIdentityCache(identity.publicId);
      await this.audit.record({
        action: 'IDENTITY_GENERATED',
        actorUserId,
        organizationId,
        entity: 'Credential',
        entityId: credential.id,
        metadata: { type: input.type, identityId: identity.publicId },
      });
      return {
        id: credential.publicId,
        type: credential.type,
        hint: credential.valueHint,
        identityId: identity.publicId,
      };
    } catch (error) {
      this.throwIfCredentialConflict(error);
      throw error;
    }
  }

  async invalidateIdentityCache(publicIdentityId: string) {
    await this.redis.del(`verify:${normalizeCode(publicIdentityId)}`);
  }

  private generatedChannelCredentials(
    productIdentityId: string,
    row: { serial: string; pid: string },
    input: {
      withBarcode?: boolean;
      withDataMatrix?: boolean;
      withNfc?: boolean;
      withRfid?: boolean;
    },
  ) {
    const data: Array<{
      publicId: string;
      productIdentityId: string;
      type: CredentialType;
      valueHash: string;
      valueHint: string;
    }> = [];
    const push = (type: CredentialType, value: string) => {
      data.push({
        publicId: publicId('crd'),
        productIdentityId,
        type,
        valueHash: sha256(normalizeCode(value)),
        valueHint: credentialHint(value),
      });
    };
    if (input.withBarcode) push(CredentialType.BARCODE, row.serial);
    if (input.withDataMatrix) push(CredentialType.DATA_MATRIX, row.pid);
    if (input.withNfc) push(CredentialType.NFC, `NFC-${row.serial}`);
    if (input.withRfid) push(CredentialType.RFID, `RFID-${row.serial}`);
    return data;
  }

  private async insertCredential(
    tx: Prisma.TransactionClient,
    productIdentityId: string,
    input: { type: CredentialType; value: string },
  ) {
    await tx.credential.create({
      data: this.credentialRecord(productIdentityId, input.type, input.value),
    });
  }

  private credentialRecord(
    productIdentityId: string,
    type: CredentialType,
    rawValue: string,
  ) {
    const value = this.normalizeCredentialValue(type, rawValue);
    return {
      publicId: publicId('crd'),
      productIdentityId,
      type,
      valueHash: sha256(normalizeCode(value)),
      valueHint: credentialHint(value),
    };
  }

  private normalizeCredentialValue(type: CredentialType, rawValue: string) {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      throw new AppError('INVALID_CODE', 'Credential value is required.', 400);
    }
    if (type === CredentialType.ISBN) {
      const parsed = parsePresentedCode(trimmed);
      if (parsed.kind !== 'isbn' || !parsed.checksumValid || !parsed.isbn13) {
        throw new AppError(
          'INVALID_ISBN',
          'ISBN must be a valid ISBN-10 or ISBN-13.',
          400,
        );
      }
      return parsed.isbn13;
    }
    if (type === CredentialType.BARCODE || type === CredentialType.DATA_MATRIX) {
      const parsed = parsePresentedCode(trimmed);
      if (
        (parsed.kind === 'gtin' || parsed.kind === 'isbn') &&
        parsed.checksumValid === false
      ) {
        throw new AppError(
          'INVALID_BARCODE',
          'That barcode checksum is invalid.',
          400,
        );
      }
      if (parsed.kind === 'gtin' && parsed.checksumValid) {
        return parsed.canonical;
      }
      if (parsed.kind === 'isbn' && parsed.isbn13) return parsed.isbn13;
    }
    return trimmed;
  }

  private throwIfCredentialConflict(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new AppError(
        'CREDENTIAL_IN_USE',
        'That code is already registered to a product identity.',
        409,
      );
    }
  }
}
