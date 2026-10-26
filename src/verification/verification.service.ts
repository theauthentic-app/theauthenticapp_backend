import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ClientPlatform,
  CredentialStatus,
  IdentityStatus,
  Prisma,
  RiskSeverity,
  RiskType,
  ScanSource,
  VerificationStatus,
} from '@prisma/client';
import {
  normalizeCode,
  publicId,
  sha256,
  verifyIdentitySignature,
} from '../common/utils/crypto.util';
import { detectImpossibleTravel } from '../common/utils/geo.util';
import { detectCredentialCloning } from '../common/utils/scan-risk.util';
import {
  parsePresentedCode,
  type PresentedCode,
} from '../common/utils/code-catalog.util';
import { scanGuidance } from './scan-guidance';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  calculateTrustScore,
  TrustSignal,
} from '../trust-score/trust-score.engine';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import {
  paginatedResult,
  paginationOf,
  type PaginationInput,
} from '../common/utils/pagination.util';
import {
  CatalogLookupService,
  type CatalogLookupResult,
} from '../catalog-lookup/catalog-lookup.service';
import type { DecodedSymbol } from './barcode-decoder.service';

export type VerifyCommand = {
  code: string;
  alternateCodes?: string[];
  decodedFromImage?: boolean;
  symbols?: DecodedSymbol[];
  source?: ScanSource;
  platform?: ClientPlatform;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  userId?: string | null;
  organizationId?: string | null;
  audience?: 'public' | 'enterprise';
};

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly webhooks: WebhooksService,
    private readonly catalogLookup: CatalogLookupService,
    private readonly notifications: NotificationsService,
  ) {}

  async lookupPassport(code: string) {
    const hashes = parsePresentedCode(code).candidates.map((value) =>
      sha256(value),
    );
    const credential = await this.prisma.credential.findFirst({
      where: { valueHash: { in: hashes } },
      include: {
        productIdentity: {
          include: {
            batch: true,
            productVariant: {
              include: {
                product: { include: { brand: true, organization: true } },
              },
            },
          },
        },
      },
    });
    if (!credential) return null;
    const identity = credential.productIdentity;
    const product = identity.productVariant.product;
    return {
      identity: { id: identity.publicId, status: identity.status },
      product: {
        id: product.publicId,
        name: product.name,
        sku: product.sku,
        category: product.category,
      },
      brand: {
        id: product.brand.publicId,
        name: product.brand.name,
        verified: product.brand.verificationStatus === 'VERIFIED',
      },
      manufacturer: {
        id: product.organization.publicId,
        name: product.organization.name,
        verified: Boolean(product.organization.verifiedAt),
      },
      batch: {
        id: identity.batch.publicId,
        batchNumber: identity.batch.batchNumber,
        expiryDate: identity.batch.expiryDate,
        recalled: identity.batch.status === 'RECALLED',
      },
    };
  }

  async verify(command: VerifyCommand) {
    const parsed = parsePresentedCode(command.code);
    const source = command.source ?? ScanSource.MANUAL;
    const candidateCodes = this.collectCandidates(parsed, command.alternateCodes);
    const hashes = candidateCodes.map((value) => sha256(value));
    const code = parsed.canonical;

    const credential = await this.prisma.credential.findFirst({
      where: { valueHash: { in: hashes } },
      include: {
        productIdentity: {
          include: {
            batch: true,
            productVariant: {
              include: {
                product: { include: { brand: true, organization: true } },
              },
            },
            verifications: {
              orderBy: { createdAt: 'desc' },
              take: 20,
            },
          },
        },
      },
    });

    if (!credential) {
      return this.respondWithoutIdentity(command, parsed, code);
    }

    const identity = credential.productIdentity;
    const product = identity.productVariant.product;
    const brand = product.brand;
    const manufacturer = product.organization;
    const batch = identity.batch;
    const secret = this.config.getOrThrow<string>('IDENTITY_SIGNING_SECRET');

    const signatureValid = verifyIdentitySignature({
      secret,
      publicId: identity.publicId,
      serialNumber: identity.serialNumber,
      variantSku: identity.productVariant.sku,
      issuedAt: identity.createdAt.toISOString(),
      signature: identity.signature,
    });

    const now = new Date();
    const expired =
      (batch.expiryDate && batch.expiryDate < now) ||
      identity.status === IdentityStatus.EXPIRED;
    const recalled =
      batch.status === 'RECALLED' ||
      identity.status === IdentityStatus.RECALLED;
    const revoked =
      identity.status === IdentityStatus.REVOKED ||
      credential.status === CredentialStatus.REVOKED;
    const compromised = identity.status === IdentityStatus.COMPROMISED;
    const active =
      identity.status === IdentityStatus.ACTIVE &&
      credential.status === CredentialStatus.ACTIVE;

    const physical =
      source === ScanSource.CAMERA ||
      source === ScanSource.MANUAL ||
      source === ScanSource.POS;
    const recent = identity.verifications.filter(
      (v) => now.getTime() - v.createdAt.getTime() < 86_400_000,
    );
    const highFrequency = recent.length >= 12;
    const clone = detectCredentialCloning(
      identity.verifications.map((scan) => ({
        createdAt: scan.createdAt,
        city: scan.city,
        country: scan.country,
        deviceHash: scan.deviceHash,
      })),
      now,
    );

    let impossible: {
      impossible: boolean;
      km: number;
      hours: number;
      from?: string;
    } | null = null;
    if (physical && command.latitude != null && command.longitude != null) {
      impossible = detectImpossibleTravel(
        identity.verifications
          .filter((v) => v.latitude != null && v.longitude != null)
          .map((v) => ({
            latitude: v.latitude as number,
            longitude: v.longitude as number,
            at: v.createdAt,
            city: v.city,
          })),
        {
          latitude: command.latitude,
          longitude: command.longitude,
          at: now,
          city: command.city,
        },
      );
    }

    const outcomes: Partial<Record<TrustSignal, boolean>> = {
      VALID_CREDENTIAL: true,
      VALID_SIGNATURE: signatureValid,
      IDENTITY_ACTIVE: active,
      KNOWN_MANUFACTURER:
        Boolean(manufacturer.verifiedAt) || manufacturer.status === 'ACTIVE',
      BRAND_VERIFIED: brand.verificationStatus === 'VERIFIED',
      BATCH_ACTIVE: batch.status === 'ACTIVE',
      NOT_RECALLED: !recalled,
      NOT_EXPIRED: !expired,
      NO_DUPLICATE:
        credential.status !== CredentialStatus.COMPROMISED && !clone.suspected,
      GEO_CONSISTENT: !impossible?.impossible,
      NORMAL_FREQUENCY: !highFrequency && !clone.burst,
    };
    const evaluation = calculateTrustScore(outcomes);

    const riskSignals: Array<{
      type: RiskType;
      severity: RiskSeverity;
      scoreImpact: number;
      evidence: Record<string, unknown>;
    }> = [];

    if (!signatureValid) {
      riskSignals.push({
        type: RiskType.INVALID_SIGNATURE,
        severity: RiskSeverity.CRITICAL,
        scoreImpact: -16,
        evidence: { public: true },
      });
    }
    if (revoked) {
      riskSignals.push({
        type: RiskType.REVOKED_CREDENTIAL,
        severity: RiskSeverity.HIGH,
        scoreImpact: -20,
        evidence: {},
      });
    }
    if (recalled) {
      riskSignals.push({
        type: RiskType.RECALLED_PRODUCT,
        severity: RiskSeverity.HIGH,
        scoreImpact: -20,
        evidence: {},
      });
    }
    if (expired) {
      riskSignals.push({
        type: RiskType.EXPIRED_PRODUCT,
        severity: RiskSeverity.MEDIUM,
        scoreImpact: -10,
        evidence: {},
      });
    }
    if (highFrequency) {
      riskSignals.push({
        type: RiskType.HIGH_SCAN_FREQUENCY,
        severity: RiskSeverity.MEDIUM,
        scoreImpact: -8,
        evidence: { window: '24h' },
      });
    }
    if (impossible?.impossible) {
      riskSignals.push({
        type: RiskType.IMPOSSIBLE_TRAVEL,
        severity: RiskSeverity.HIGH,
        scoreImpact: -18,
        evidence: {
          km: Math.round(impossible.km),
          hours: Number(impossible.hours.toFixed(2)),
        },
      });
    }

    if (clone.suspected) {
      riskSignals.push({
        type: RiskType.DUPLICATE_CREDENTIAL,
        severity: clone.multiCountry
          ? RiskSeverity.CRITICAL
          : RiskSeverity.HIGH,
        scoreImpact: clone.multiCountry ? -20 : -12,
        evidence: {
          cities: clone.cities,
          countries: clone.countries,
          devices: clone.devices,
          burst: clone.burst,
        },
      });
    }

    let status: VerificationStatus = VerificationStatus.AUTHENTICATED;
    const reasons: string[] = [];
    const warnings: string[] = [];

    if (revoked) {
      status = VerificationStatus.REVOKED;
      reasons.push('This product identity has been revoked by the issuer.');
    } else if (compromised || impossible?.impossible || clone.multiCountry) {
      status = VerificationStatus.COMPROMISED;
      reasons.push(
        impossible?.impossible
          ? 'This identity was observed in locations that a single physical product cannot plausibly occupy.'
          : clone.multiCountry
            ? 'This identity is circulating in a pattern consistent with a cloned credential.'
            : 'This product identity has been marked as compromised.',
      );
    } else if (recalled) {
      status = VerificationStatus.RECALLED;
      reasons.push('This product is subject to a manufacturer recall.');
    } else if (expired) {
      status = VerificationStatus.EXPIRED;
      reasons.push('This product is past its expiry date.');
    } else if (!signatureValid) {
      status = VerificationStatus.COMPROMISED;
      reasons.push('The product identity signature could not be validated.');
    } else if (
      !active ||
      highFrequency ||
      clone.suspected ||
      evaluation.score < 85
    ) {
      status = VerificationStatus.SUSPICIOUS;
      reasons.push(
        'The identity exists, but unusual or incomplete evidence was detected.',
      );
      if (!active) warnings.push('This identity is not in an active state.');
      if (highFrequency || clone.burst)
        warnings.push('Scan frequency is unusually high.');
      if (clone.scatter)
        warnings.push(
          'This identity was presented from several cities and devices in a short window.',
        );
    } else {
      reasons.push(
        'This product identity was issued by the manufacturer and the verification data is valid.',
      );
    }

    if (impossible?.impossible || clone.multiCountry) {
      await this.prisma.productIdentity.update({
        where: { id: identity.id },
        data: { status: IdentityStatus.COMPROMISED, compromisedAt: now },
      });
      await this.redis.del(`verify:${normalizeCode(identity.publicId)}`);
    }

    const publicSignals = evaluation.granted.map((signal) => ({
      code: signal,
      passed: true,
    }));

    return this.persistAndRespond({
      command,
      code,
      parsed,
      status,
      trustScore: evaluation.score,
      reasons,
      warnings,
      signals: publicSignals.concat(
        evaluation.denied.map((signal) => ({
          code: signal,
          passed: false,
        })),
      ),
      product: {
        id: product.publicId,
        name: product.name,
        sku: product.sku,
        category: product.category,
        countryOfOrigin: product.countryOfOrigin,
        description: product.description,
        gtin: product.gtin,
        isbn: product.isbn,
      },
      brand: {
        id: brand.publicId,
        name: brand.name,
        verified: brand.verificationStatus === 'VERIFIED',
      },
      manufacturer: {
        id: manufacturer.publicId,
        name: manufacturer.name,
        verified: Boolean(manufacturer.verifiedAt),
      },
      batch: {
        id: batch.publicId,
        batchNumber: batch.batchNumber,
        manufacturingDate: batch.manufacturingDate,
        expiryDate: batch.expiryDate,
        recalled: batch.status === 'RECALLED',
      },
      identity,
      previousScans: identity.verifications.slice(0, 8).map((scan) => ({
        city: scan.city,
        country: scan.country,
        createdAt: scan.createdAt,
        source: scan.source,
      })),
      credential,
      riskSignals,
    });
  }

  private async persistAndRespond(input: {
    command: VerifyCommand;
    code: string;
    parsed: PresentedCode;
    status: VerificationStatus;
    trustScore: number;
    reasons: string[];
    warnings: string[];
    signals: Array<{ code: string; passed: boolean }>;
    product: Record<string, unknown> | null;
    brand?: Record<string, unknown>;
    manufacturer?: Record<string, unknown>;
    batch?: Record<string, unknown>;
    lookup?: CatalogLookupResult | null;
    identity: {
      id: string;
      publicId: string;
      serialNumber: string;
      organizationId: string;
      status: IdentityStatus;
    } | null;
    previousScans?: Array<{
      city: string | null;
      country: string | null;
      createdAt: Date;
      source: ScanSource;
    }>;
    credential: { id: string } | null;
    riskSignals?: Array<{
      type: RiskType;
      severity: RiskSeverity;
      scoreImpact: number;
      evidence: Record<string, unknown>;
    }>;
  }) {
    const verification = await this.prisma.verification.create({
      data: {
        publicId: publicId('ver'),
        productIdentityId: input.identity?.id,
        credentialId: input.credential?.id,
        userId: input.command.userId,
        organizationId: input.command.organizationId,
        status: input.status,
        trustScore: input.trustScore,
        reasons: input.reasons,
        signals: input.signals,
        warnings: input.warnings,
        source: input.command.source ?? ScanSource.MANUAL,
        platform: input.command.platform ?? ClientPlatform.WEB,
        country: input.command.country,
        region: input.command.region,
        city: input.command.city,
        latitude: input.command.latitude,
        longitude: input.command.longitude,
        ipHash: input.command.ip ? sha256(input.command.ip) : null,
        deviceHash: input.command.userAgent
          ? sha256(input.command.userAgent)
          : null,
      },
    });

    if (input.riskSignals?.length) {
      await this.prisma.riskSignal.createMany({
        data: input.riskSignals.map((signal) => ({
          type: signal.type,
          severity: signal.severity,
          scoreImpact: signal.scoreImpact,
          evidence: signal.evidence as Prisma.InputJsonValue,
          verificationId: verification.id,
          productIdentityId: input.identity?.id,
        })),
      });
    }

    if (input.identity) {
      await this.webhooks.enqueue(
        input.identity.organizationId,
        'verification.created',
        {
          verificationId: verification.publicId,
          status: input.status,
          identityId: input.identity.publicId,
          trustScore: input.trustScore,
        },
      );
      if (
        input.status === VerificationStatus.COMPROMISED ||
        input.status === VerificationStatus.RECALLED
      ) {
        await this.webhooks.enqueue(
          input.identity.organizationId,
          'risk.detected',
          {
            verificationId: verification.publicId,
            status: input.status,
            identityId: input.identity.publicId,
          },
        );
        this.notifications.notifyOrganizationSafe(
          input.identity.organizationId,
          {
            subject: `Risk alert: ${input.status} scan`,
            template: 'risk-alert',
            context: {
              status: input.status,
              identityId: input.identity.publicId,
              city: input.command.city,
              country: input.command.country,
            },
            onceKey: `mail:risk:${input.identity.id}`,
            onceTtlSeconds: 3600,
          },
        );
      }
    }

    const body = {
      verificationId: verification.publicId,
      status: input.status,
      trustScore: input.trustScore,
      verifiedAt: verification.createdAt,
      product: input.product,
      brand: input.brand ?? null,
      manufacturer: input.manufacturer ?? null,
      batch: input.batch ?? null,
      identity: input.identity
        ? {
            id: input.identity.publicId,
            serial:
              input.command.audience === 'enterprise'
                ? input.identity.serialNumber
                : undefined,
            status: input.identity.status,
          }
        : null,
      signals: input.signals,
      warnings: input.warnings,
      reasons: input.reasons,
      previousScans: input.previousScans ?? [],
      guidance: scanGuidance(input.status, Boolean(input.identity)),
      scan: {
        decodedFromImage: Boolean(input.command.decodedFromImage),
        kind: input.parsed.kind,
        canonicalCode: input.parsed.canonical,
        checksumValid: input.parsed.checksumValid,
        symbols: (input.command.symbols ?? []).map((symbol) => ({
          text: symbol.text,
          format: symbol.format,
          credentialType: symbol.credentialType,
        })),
      },
      lookup: input.lookup ?? null,
    };

    if (input.command.audience !== 'enterprise' && body.identity) {
      delete (body.identity as { serial?: string }).serial;
    }

    return body;
  }

  async getByPublicId(id: string, audience: 'public' | 'enterprise') {
    const verification = await this.prisma.verification.findUnique({
      where: { publicId: id },
      include: {
        productIdentity: {
          include: { productVariant: { include: { product: true } } },
        },
      },
    });
    if (!verification) return null;
    return {
      verificationId: verification.publicId,
      status: verification.status,
      trustScore: verification.trustScore,
      verifiedAt: verification.createdAt,
      reasons: verification.reasons,
      warnings: verification.warnings,
      signals: audience === 'enterprise' ? verification.signals : undefined,
    };
  }

  async listForOrganization(
    organizationId: string,
    query?: PaginationInput,
  ) {
    const { page, limit, skip, take } = paginationOf(query);
    const where = { productIdentity: { organizationId } };
    const [scans, total] = await this.prisma.$transaction([
      this.prisma.verification.findMany({
        where,
        include: {
          productIdentity: {
            include: { productVariant: { include: { product: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.verification.count({ where }),
    ]);
    return paginatedResult(
      scans.map((event) => ({
        id: event.publicId,
        status: event.status,
        trustScore: event.trustScore,
        city: event.city,
        country: event.country,
        source: event.source,
        createdAt: event.createdAt,
        identityId: event.productIdentity?.publicId,
        productName: event.productIdentity?.productVariant.product.name,
      })),
      total,
      page,
      limit,
    );
  }

  private collectCandidates(
    parsed: PresentedCode,
    alternateCodes?: string[],
  ): string[] {
    const values = new Set(parsed.candidates);
    for (const extra of alternateCodes ?? []) {
      for (const candidate of parsePresentedCode(extra).candidates) {
        values.add(candidate);
      }
    }
    return [...values];
  }

  private async respondWithoutIdentity(
    command: VerifyCommand,
    parsed: PresentedCode,
    code: string,
  ) {
    const catalogProduct = await this.findCatalogProduct(parsed);
    const lookup =
      !catalogProduct && (parsed.kind === 'isbn' || parsed.kind === 'gtin')
        ? await this.catalogLookup.lookup(parsed)
        : null;
    const identified = Boolean(catalogProduct || lookup?.found);
    const warnings: string[] = [];
    if (parsed.checksumValid === false) {
      warnings.push(
        'The code checksum is invalid. The printed barcode may be damaged or incomplete.',
      );
    }
    const reasons = catalogProduct
      ? [
          parsed.kind === 'isbn'
            ? 'This ISBN identifies an edition, not a unique physical copy. AUTHENTIC cannot confirm this copy is genuine without a serialized identity.'
            : 'This GTIN identifies a product type, not a unique unit. Ask the brand for a serialized AUTHENTIC identity.',
        ]
      : lookup?.found
        ? [
            parsed.kind === 'isbn'
              ? 'This ISBN matches a published edition in a public catalog. AUTHENTIC cannot confirm this copy is genuine without a serialized identity.'
              : 'This barcode matches a product type in a public catalog. AUTHENTIC cannot confirm this unit is genuine without a serialized identity.',
          ]
        : ['No AUTHENTIC product identity matches this credential.'];

    return this.persistAndRespond({
      command,
      code,
      parsed,
      status: identified
        ? VerificationStatus.UNVERIFIED
        : VerificationStatus.NOT_FOUND,
      trustScore: 0,
      reasons,
      warnings,
      signals: [],
      product: catalogProduct
        ? {
            id: catalogProduct.publicId,
            name: catalogProduct.name,
            sku: catalogProduct.sku,
            gtin: catalogProduct.gtin,
            isbn: catalogProduct.isbn,
          }
        : lookup?.found
          ? {
              id: null,
              name: lookup.title,
              sku: null,
              gtin: lookup.gtin ?? null,
              isbn: lookup.isbn13 ?? null,
              catalogSource: lookup.source,
            }
          : null,
      lookup,
      identity: null,
      credential: null,
    });
  }

  private async findCatalogProduct(parsed: PresentedCode) {
    if (parsed.kind !== 'isbn' && parsed.kind !== 'gtin') return null;
    const codes = parsed.candidates;
    return this.prisma.product.findFirst({
      where: {
        OR: [
          { isbn: { in: codes } },
          { gtin: { in: codes } },
          { variants: { some: { gtin: { in: codes } } } },
        ],
      },
    });
  }
}
