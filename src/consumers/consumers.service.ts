import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ConsumersService {
  constructor(private readonly prisma: PrismaService) {}

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
