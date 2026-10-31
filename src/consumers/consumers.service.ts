import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ConsumersService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(userId: string, days = 30) {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);

    const [
      totalScans,
      scansInRange,
      statusGroups,
      recentScans,
      walletItems,
      reportsFiled,
      reportsOpen,
      warranties,
      scanTrend,
      brandRows,
    ] = await Promise.all([
      this.prisma.verification.count({ where: { userId } }),
      this.prisma.verification.count({
        where: { userId, createdAt: { gte: from, lte: to } },
      }),
      this.prisma.verification.groupBy({
        by: ['status'],
        where: { userId },
        _count: { _all: true },
      }),
      this.prisma.verification.findMany({
        where: { userId },
        include: {
          productIdentity: {
            include: {
              productVariant: {
                include: { product: { include: { brand: true } } },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      this.prisma.walletItem.findMany({
        where: { userId },
        include: {
          productIdentity: {
            include: {
              productVariant: {
                include: { product: { include: { brand: true } } },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 40,
      }),
      this.prisma.productReport.count({ where: { userId } }),
      this.prisma.productReport.count({
        where: { userId, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
      }),
      this.prisma.warranty.count({ where: { ownerUserId: userId } }),
      this.prisma.$queryRaw<Array<{ day: Date; scans: bigint }>>`
        SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS scans
        FROM "Verification"
        WHERE "userId" = ${userId}
          AND "createdAt" >= ${from}
          AND "createdAt" <= ${to}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      this.prisma.$queryRaw<
        Array<{ brand: string; scans: bigint }>
      >`
        SELECT b.name AS brand, COUNT(v.id)::bigint AS scans
        FROM "Verification" v
        JOIN "ProductIdentity" i ON i.id = v."productIdentityId"
        JOIN "ProductVariant" pv ON pv.id = i."productVariantId"
        JOIN "Product" p ON p.id = pv."productId"
        JOIN "Brand" b ON b.id = p."brandId"
        WHERE v."userId" = ${userId}
        GROUP BY b.name
        ORDER BY scans DESC
        LIMIT 8
      `,
    ]);

    const statusOf = (status: string) =>
      statusGroups.find((row) => row.status === status)?._count._all ?? 0;

    const authenticated = statusOf('AUTHENTICATED');
    const suspicious = statusOf('SUSPICIOUS');
    const compromised = statusOf('COMPROMISED');
    const recalled = statusOf('RECALLED');
    const revoked = statusOf('REVOKED');
    const notFound = statusOf('NOT_FOUND');
    const alertScans = suspicious + compromised + recalled + revoked;

    const walletProductIds = [
      ...new Set(
        walletItems.map(
          (w) => w.productIdentity.productVariant.product.id,
        ),
      ),
    ];
    const walletBatchIds = [
      ...new Set(walletItems.map((w) => w.productIdentity.batchId)),
    ];
    const activeRecalls =
      walletProductIds.length === 0 && walletBatchIds.length === 0
        ? []
        : await this.prisma.recall.findMany({
            where: {
              status: 'ACTIVE',
              OR: [
                { products: { some: { productId: { in: walletProductIds } } } },
                { batches: { some: { batchId: { in: walletBatchIds } } } },
              ],
            },
            select: {
              publicId: true,
              recallNumber: true,
              reason: true,
              severity: true,
              instructions: true,
            },
            take: 10,
          });

    const wallet = walletItems.map((item) => {
      const identity = item.productIdentity;
      const product = identity.productVariant.product;
      const riskyStatus = ['REVOKED', 'COMPROMISED', 'RECALLED'].includes(
        identity.status,
      );
      return {
        id: item.id,
        savedAt: item.createdAt,
        atRisk: riskyStatus,
        unit: {
          authenticId: identity.publicId,
          serial: identity.serialNumber,
          status: identity.status,
          product: {
            name: product.name,
            brand: product.brand.name,
            imageHue: this.hue(product.sku),
          },
        },
      };
    });

    const atRiskWallet = wallet.filter((w) => w.atRisk);

    const alerts: Array<{
      severity: 'info' | 'warning' | 'critical';
      code: string;
      title: string;
      detail: string;
    }> = [];

    if (activeRecalls.length > 0) {
      alerts.push({
        severity: 'critical',
        code: 'WALLET_RECALL',
        title: 'Recall on a saved product',
        detail: `${activeRecalls.length} active recall(s) may affect items in your wallet.`,
      });
    }
    if (atRiskWallet.length > 0) {
      alerts.push({
        severity: 'critical',
        code: 'WALLET_AT_RISK',
        title: 'Saved product needs attention',
        detail: `${atRiskWallet.length} wallet item(s) are revoked, compromised, or recalled.`,
      });
    }
    if (compromised + recalled > 0) {
      alerts.push({
        severity: 'warning',
        code: 'PAST_RISK_SCANS',
        title: 'Past high-risk scans',
        detail: `You have ${compromised + recalled} scan(s) marked compromised or recalled.`,
      });
    }
    if (reportsOpen > 0) {
      alerts.push({
        severity: 'info',
        code: 'OPEN_REPORTS',
        title: 'Reports in review',
        detail: `${reportsOpen} of your reports are still open.`,
      });
    }
    if (suspicious > 0 && compromised + recalled === 0) {
      alerts.push({
        severity: 'info',
        code: 'SUSPICIOUS_HISTORY',
        title: 'Suspicious scan history',
        detail: `${suspicious} scan(s) returned a suspicious result — buy from trusted sellers.`,
      });
    }

    const trustScore =
      totalScans === 0
        ? null
        : Math.max(
            0,
            Math.min(
              100,
              Math.round(
                ((authenticated - alertScans * 1.5) / totalScans) * 100,
              ),
            ),
          );

    const facts = [
      {
        code: 'SCANS_TOTAL',
        label: 'Products you have checked',
        value: totalScans,
      },
      {
        code: 'AUTHENTIC_RATE',
        label: 'Authenticated scan rate',
        value:
          totalScans === 0
            ? null
            : `${Math.round((authenticated / totalScans) * 1000) / 10}%`,
      },
      {
        code: 'WALLET_SIZE',
        label: 'Saved in wallet',
        value: wallet.length,
      },
      {
        code: 'PERSONAL_TRUST',
        label: 'Personal trust index',
        value: trustScore,
        hint: 'Derived from your AUTHENTICATED vs risk scan mix (not a product verdict).',
      },
      {
        code: 'REPORTS',
        label: 'Reports you filed',
        value: reportsFiled,
      },
      {
        code: 'WARRANTIES',
        label: 'Warranties on file',
        value: warranties,
      },
    ];

    return {
      meta: {
        audience: 'consumer',
        range: { from, to, days },
        generatedAt: new Date().toISOString(),
      },
      summary: {
        totalScans,
        scansInRange,
        authenticated,
        suspicious,
        compromised,
        recalled,
        revoked,
        notFound,
        alertScans,
        walletCount: wallet.length,
        walletAtRisk: atRiskWallet.length,
        reportsFiled,
        reportsOpen,
        warranties,
        trustScore,
      },
      facts,
      alerts,
      timeline: scanTrend.map((row) => ({
        day: row.day,
        scans: Number(row.scans),
      })),
      brands: brandRows.map((row) => ({
        name: row.brand,
        scans: Number(row.scans),
      })),
      recentScans: recentScans.map((scan) => {
        const product = scan.productIdentity?.productVariant.product;
        return {
          id: scan.publicId,
          status: scan.status,
          createdAt: scan.createdAt,
          city: scan.city,
          country: scan.country,
          unit: scan.productIdentity
            ? {
                authenticId: scan.productIdentity.publicId,
                product: {
                  name: product?.name,
                  brand: product?.brand.name,
                },
              }
            : null,
        };
      }),
      wallet: {
        items: wallet,
        atRisk: atRiskWallet,
      },
      recalls: activeRecalls,
      suggestedActions: this.consumerActions(alerts, totalScans, wallet.length),
    };
  }

  private consumerActions(
    alerts: Array<{ code: string }>,
    totalScans: number,
    walletCount: number,
  ) {
    const actions: Array<{ code: string; label: string; href: string }> = [];
    if (alerts.some((a) => a.code.startsWith('WALLET_'))) {
      actions.push({
        code: 'REVIEW_WALLET',
        label: 'Review saved products',
        href: '/wallet',
      });
    }
    if (totalScans === 0) {
      actions.push({
        code: 'FIRST_SCAN',
        label: 'Scan your first product',
        href: '/scan',
      });
    } else {
      actions.push({
        code: 'SCAN_AGAIN',
        label: 'Scan another product',
        href: '/scan',
      });
    }
    if (walletCount === 0 && totalScans > 0) {
      actions.push({
        code: 'SAVE_TO_WALLET',
        label: 'Save a verified product',
        href: '/history',
      });
    }
    if (alerts.some((a) => a.code === 'OPEN_REPORTS')) {
      actions.push({
        code: 'VIEW_REPORTS',
        label: 'Check your reports',
        href: '/reports',
      });
    }
    return actions.slice(0, 5);
  }

  async reports(userId: string) {
    const rows = await this.prisma.productReport.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        productIdentity: { select: { publicId: true } },
      },
    });
    return rows.map((r) => ({
      id: r.publicId,
      reason: r.reason,
      status: r.status,
      description: r.description,
      city: r.city,
      country: r.country,
      reviewOutcome: r.reviewOutcome,
      createdAt: r.createdAt,
      identityId: r.productIdentity?.publicId ?? null,
    }));
  }

  async history(userId: string) {
    const scans = await this.prisma.verification.findMany({
      where: { userId },
      include: {
        productIdentity: {
          include: { productVariant: { include: { product: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return scans.map((scan) => ({
      id: scan.publicId,
      status: scan.status,
      createdAt: scan.createdAt,
      city: scan.city,
      country: scan.country,
      identifier: scan.productIdentity?.publicId ?? scan.publicId,
      unit: scan.productIdentity
        ? {
            authenticId: scan.productIdentity.publicId,
            product: {
              name: scan.productIdentity.productVariant.product.name,
            },
          }
        : null,
    }));
  }

  async wallet(userId: string) {
    const items = await this.prisma.walletItem.findMany({
      where: { userId },
      include: {
        productIdentity: {
          include: {
            productVariant: {
              include: { product: { include: { brand: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return items.map((item) => {
      const product = item.productIdentity.productVariant.product;
      return {
        id: item.id,
        unit: {
          authenticId: item.productIdentity.publicId,
          serial: item.productIdentity.serialNumber,
          product: {
            name: product.name,
            brand: product.brand.name,
            imageHue: this.hue(product.sku),
          },
        },
      };
    });
  }

  async saveWallet(userId: string, identityPublicId: string) {
    const identity = await this.prisma.productIdentity.findUnique({
      where: { publicId: identityPublicId },
    });
    if (!identity) {
      throw new AppError(
        'IDENTITY_NOT_FOUND',
        'That product identity was not found.',
        404,
      );
    }
    const item = await this.prisma.walletItem.upsert({
      where: {
        userId_productIdentityId: {
          userId,
          productIdentityId: identity.id,
        },
      },
      update: {},
      create: { userId, productIdentityId: identity.id },
    });
    return { id: item.id, identityId: identity.publicId };
  }

  private hue(seed: string) {
    let hash = 0;
    for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) % 360;
    return `${hash}`;
  }
}
