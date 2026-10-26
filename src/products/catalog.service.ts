import { Injectable } from '@nestjs/common';
import {
  BrandStatus,
  BrandVerificationStatus,
  FilePurpose,
  ProductCategory,
  ProductStatus,
} from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { publicId } from '../common/utils/crypto.util';
import { normalizeProductCode } from '../common/utils/code-catalog.util';
import { BillingService } from '../billing/billing.service';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FilesService } from '../files/files.service';
import {
  paginatedResult,
  paginationOf,
  type PaginationInput,
} from '../common/utils/pagination.util';
import { assertOrgWritable } from '../common/utils/org-status.util';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
    private readonly files: FilesService,
  ) {}

  async createBrand(
    organizationId: string,
    actorUserId: string | undefined,
    input: { name: string; description?: string; website?: string },
  ) {
    await this.assertWritable(organizationId);
    await this.billing.assertBrandQuota(organizationId);
    const slug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const brand = await this.prisma.brand.create({
      data: {
        publicId: publicId('brd'),
        organizationId,
        name: input.name,
        slug,
        description: input.description,
        website: input.website,
        verificationStatus: BrandVerificationStatus.UNVERIFIED,
        status: BrandStatus.ACTIVE,
      },
    });
    return this.publicBrand(brand);
  }

  async updateBrand(
    organizationId: string,
    brandPublicId: string,
    actorUserId: string | undefined,
    input: { name?: string; description?: string; website?: string },
  ) {
    await this.assertWritable(organizationId);
    const brand = await this.requireBrand(organizationId, brandPublicId);
    const slug = input.name
      ? input.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '')
      : undefined;
    const updated = await this.prisma.brand.update({
      where: { id: brand.id },
      data: {
        name: input.name ?? brand.name,
        slug: slug ?? brand.slug,
        description: input.description ?? brand.description,
        website: input.website ?? brand.website,
      },
    });
    await this.audit.record({
      action: 'BRAND_UPDATED',
      actorUserId,
      organizationId,
      entity: 'Brand',
      entityId: updated.id,
    });
    return this.publicBrand(updated);
  }

  async deleteBrand(organizationId: string, brandPublicId: string) {
    await this.assertWritable(organizationId);
    const brand = await this.requireBrand(organizationId, brandPublicId);
    const products = await this.prisma.product.count({
      where: { brandId: brand.id },
    });
    if (products > 0) {
      const updated = await this.prisma.brand.update({
        where: { id: brand.id },
        data: { status: BrandStatus.INACTIVE },
      });
      return { id: updated.publicId, status: updated.status, archived: true };
    }
    await this.prisma.brand.delete({ where: { id: brand.id } });
    return { id: brand.publicId, deleted: true };
  }

  async listBrands(organizationId: string, query?: PaginationInput) {
    const { page, limit, skip, take } = paginationOf(query);
    const where = { organizationId };
    const [brands, total] = await this.prisma.$transaction([
      this.prisma.brand.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.brand.count({ where }),
    ]);
    return paginatedResult(
      brands.map((b) => this.publicBrand(b)),
      total,
      page,
      limit,
    );
  }

  async createProduct(
    organizationId: string,
    actorUserId: string | undefined,
    input: {
      brandId?: string;
      brandName?: string;
      name: string;
      sku: string;
      category: string;
      gtin?: string;
      isbn?: string;
      description?: string;
      countryOfOrigin?: string;
    },
  ) {
    await this.assertWritable(organizationId);
    const brand = await this.resolveBrand(organizationId, input);
    const product = await this.prisma.product.create({
      data: {
        publicId: publicId('prd'),
        organizationId,
        brandId: brand.id,
        name: input.name,
        sku: input.sku,
        category: this.mapCategory(input.category),
        gtin: this.requireProductCode(input.gtin, 'gtin'),
        isbn: this.requireProductCode(input.isbn, 'isbn'),
        description: input.description,
        countryOfOrigin: input.countryOfOrigin ?? 'NG',
        status: ProductStatus.ACTIVE,
        variants: {
          create: {
            publicId: publicId('var'),
            name: 'Default',
            sku: `${input.sku}-DEF`,
          },
        },
      },
      include: { variants: true },
    });
    await this.audit.record({
      action: 'PRODUCT_CREATED',
      actorUserId,
      organizationId,
      entity: 'Product',
      entityId: product.id,
    });
    return {
      ...this.publicProduct(product, brand.publicId),
      brand: brand.name,
      variants: product.variants.map((v) => ({
        id: v.publicId,
        name: v.name,
        sku: v.sku,
      })),
    };
  }

  async listProducts(organizationId: string, query?: PaginationInput) {
    const { page, limit, skip, take } = paginationOf(query);
    const where = { organizationId };
    const [products, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: {
          brand: true,
          images: { orderBy: { sortOrder: 'asc' } },
          variants: {
            include: {
              _count: { select: { identities: true, batches: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.product.count({ where }),
    ]);
    const items = await Promise.all(
      products.map(async (p) => ({
        ...this.publicProduct(p, p.brand.publicId),
        brand: p.brand.name,
        variants: p.variants.map((v) => ({
          id: v.publicId,
          name: v.name,
          sku: v.sku,
        })),
        identityCount: p.variants.reduce((n, v) => n + v._count.identities, 0),
        batchCount: p.variants.reduce((n, v) => n + v._count.batches, 0),
        images: await this.productImages(p.images),
      })),
    );
    return paginatedResult(items, total, page, limit);
  }

  async getProduct(publicIdValue: string) {
    const product = await this.prisma.product.findUnique({
      where: { publicId: publicIdValue },
      include: { brand: true, organization: true, variants: true, images: true },
    });
    if (!product)
      throw new AppError('PRODUCT_NOT_FOUND', 'Product not found.', 404);
    return {
      ...this.publicProduct(product, product.brand.publicId),
      manufacturer: {
        id: product.organization.publicId,
        name: product.organization.name,
        verified: Boolean(product.organization.verifiedAt),
      },
      brand: this.publicBrand(product.brand),
      variants: product.variants.map((v) => ({
        id: v.publicId,
        name: v.name,
        sku: v.sku,
        gtin: v.gtin,
        active: v.active,
      })),
      images: await this.productImages(product.images),
    };
  }

  async attachProductImage(
    organizationId: string,
    productPublicId: string,
    file: { buffer: Buffer; mimeType: string; originalName: string },
  ) {
    const product = await this.prisma.product.findFirst({
      where: {
        organizationId,
        OR: [{ publicId: productPublicId }, { id: productPublicId }],
      },
      include: { images: true },
    });
    if (!product)
      throw new AppError('PRODUCT_NOT_FOUND', 'Product not found.', 404);
    const stored = await this.files.store({
      buffer: file.buffer,
      mimeType: file.mimeType,
      originalName: file.originalName,
      purpose: FilePurpose.PRODUCT_IMAGE,
      organizationId,
    });
    await this.prisma.productImage.create({
      data: {
        productId: product.id,
        fileId: stored.id,
        sortOrder: product.images.length,
      },
    });
    return stored;
  }

  private async productImages(images: Array<{ fileId: string; sortOrder: number }>) {
    if (images.length === 0) return [];
    const files = await this.prisma.storedFile.findMany({
      where: { id: { in: images.map((image) => image.fileId) } },
    });
    const byId = new Map(files.map((file) => [file.id, file]));
    return images
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .flatMap((image) => {
        const file = byId.get(image.fileId);
        return file ? [this.files.toPublic(file)] : [];
      });
  }

  async createVariant(
    organizationId: string,
    input: {
      productId: string;
      name: string;
      sku: string;
      gtin?: string;
      attributes?: object;
    },
  ) {
    const product = await this.prisma.product.findFirst({
      where: {
        organizationId,
        OR: [{ publicId: input.productId }, { id: input.productId }],
      },
    });
    if (!product)
      throw new AppError('PRODUCT_NOT_FOUND', 'Product not found.', 404);
    const variant = await this.prisma.productVariant.create({
      data: {
        publicId: publicId('var'),
        productId: product.id,
        name: input.name,
        sku: input.sku,
        gtin: this.requireProductCode(input.gtin, 'gtin'),
        attributes: input.attributes ?? undefined,
      },
    });
    return {
      id: variant.publicId,
      name: variant.name,
      sku: variant.sku,
      gtin: variant.gtin,
    };
  }

  async createBatch(
    organizationId: string,
    actorUserId: string | undefined,
    input: {
      variantId?: string;
      productId?: string;
      batchNumber: string;
      manufacturingDate: string;
      expiryDate?: string;
      quantity: number;
    },
  ) {
    const variant = await this.resolveVariant(organizationId, input);
    const batch = await this.prisma.batch.create({
      data: {
        publicId: publicId('bat'),
        organizationId,
        productVariantId: variant.id,
        batchNumber: input.batchNumber,
        manufacturingDate: new Date(input.manufacturingDate),
        expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
        quantity: input.quantity,
      },
    });
    await this.audit.record({
      action: 'BATCH_CREATED',
      actorUserId,
      organizationId,
      entity: 'Batch',
      entityId: batch.id,
    });
    return {
      id: batch.publicId,
      batchNumber: batch.batchNumber,
      quantity: batch.quantity,
      status: batch.status,
    };
  }

  async listBatches(organizationId: string, query?: PaginationInput) {
    const { page, limit, skip, take } = paginationOf(query);
    const where = { organizationId };
    const [batches, total] = await this.prisma.$transaction([
      this.prisma.batch.findMany({
        where,
        include: {
          productVariant: { include: { product: true } },
          _count: { select: { identities: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.batch.count({ where }),
    ]);
    return paginatedResult(
      batches.map((b) => ({
        id: b.publicId,
        batchNumber: b.batchNumber,
        quantity: b.quantity,
        status: b.status,
        manufacturingDate: b.manufacturingDate,
        expiryDate: b.expiryDate,
        identityCount: b._count.identities,
        productId: b.productVariant.product.publicId,
        productName: b.productVariant.product.name,
        variantId: b.productVariant.publicId,
      })),
      total,
      page,
      limit,
    );
  }

  async updateProduct(
    organizationId: string,
    productPublicId: string,
    actorUserId: string | undefined,
    input: {
      name?: string;
      sku?: string;
      category?: string;
      gtin?: string;
      isbn?: string;
      description?: string;
      countryOfOrigin?: string;
      status?: string;
    },
  ) {
    await this.assertWritable(organizationId);
    const product = await this.prisma.product.findFirst({
      where: { organizationId, publicId: productPublicId },
      include: { brand: true },
    });
    if (!product) {
      throw new AppError('PRODUCT_NOT_FOUND', 'Product not found.', 404);
    }
    const updated = await this.prisma.product.update({
      where: { id: product.id },
      data: {
        name: input.name ?? product.name,
        sku: input.sku ?? product.sku,
        category: input.category
          ? this.mapCategory(input.category)
          : product.category,
        gtin: input.gtin
          ? this.requireProductCode(input.gtin, 'gtin')
          : product.gtin,
        isbn: input.isbn
          ? this.requireProductCode(input.isbn, 'isbn')
          : product.isbn,
        description: input.description ?? product.description,
        countryOfOrigin: input.countryOfOrigin ?? product.countryOfOrigin,
        status: this.mapProductStatus(input.status) ?? product.status,
      },
    });
    await this.audit.record({
      action: 'PRODUCT_UPDATED',
      actorUserId,
      organizationId,
      entity: 'Product',
      entityId: updated.id,
    });
    return this.publicProduct(updated, product.brand.publicId);
  }

  async deleteProduct(organizationId: string, productPublicId: string) {
    await this.assertWritable(organizationId);
    const product = await this.prisma.product.findFirst({
      where: { organizationId, publicId: productPublicId },
      include: { variants: { include: { _count: { select: { identities: true } } } } },
    });
    if (!product) {
      throw new AppError('PRODUCT_NOT_FOUND', 'Product not found.', 404);
    }
    const identityCount = product.variants.reduce(
      (n, variant) => n + variant._count.identities,
      0,
    );
    if (identityCount > 0) {
      const updated = await this.prisma.product.update({
        where: { id: product.id },
        data: { status: ProductStatus.ARCHIVED },
      });
      return { id: updated.publicId, status: updated.status, archived: true };
    }
    await this.prisma.product.delete({ where: { id: product.id } });
    return { id: product.publicId, deleted: true };
  }

  async updateVariant(
    organizationId: string,
    variantPublicId: string,
    input: { name?: string; sku?: string; gtin?: string },
  ) {
    await this.assertWritable(organizationId);
    const variant = await this.prisma.productVariant.findFirst({
      where: { publicId: variantPublicId, product: { organizationId } },
    });
    if (!variant) {
      throw new AppError('VARIANT_NOT_FOUND', 'Variant not found.', 404);
    }
    const updated = await this.prisma.productVariant.update({
      where: { id: variant.id },
      data: {
        name: input.name ?? variant.name,
        sku: input.sku ?? variant.sku,
        gtin: input.gtin ?? variant.gtin,
      },
    });
    return {
      id: updated.publicId,
      name: updated.name,
      sku: updated.sku,
      gtin: updated.gtin,
    };
  }

  async deleteVariant(organizationId: string, variantPublicId: string) {
    await this.assertWritable(organizationId);
    const variant = await this.prisma.productVariant.findFirst({
      where: { publicId: variantPublicId, product: { organizationId } },
      include: { _count: { select: { identities: true } } },
    });
    if (!variant) {
      throw new AppError('VARIANT_NOT_FOUND', 'Variant not found.', 404);
    }
    if (variant._count.identities > 0) {
      throw new AppError(
        'VARIANT_IN_USE',
        'This variant has identities and cannot be deleted.',
        409,
      );
    }
    await this.prisma.productVariant.delete({ where: { id: variant.id } });
    return { id: variant.publicId, deleted: true };
  }

  async updateBatch(
    organizationId: string,
    batchPublicId: string,
    input: { batchNumber?: string; expiryDate?: string; quantity?: number },
  ) {
    await this.assertWritable(organizationId);
    const batch = await this.prisma.batch.findFirst({
      where: { organizationId, publicId: batchPublicId },
    });
    if (!batch) throw new AppError('BATCH_NOT_FOUND', 'Batch not found.', 404);
    const updated = await this.prisma.batch.update({
      where: { id: batch.id },
      data: {
        batchNumber: input.batchNumber ?? batch.batchNumber,
        expiryDate: input.expiryDate
          ? new Date(input.expiryDate)
          : batch.expiryDate,
        quantity: input.quantity ?? batch.quantity,
      },
    });
    return {
      id: updated.publicId,
      batchNumber: updated.batchNumber,
      quantity: updated.quantity,
      status: updated.status,
    };
  }

  private async resolveBrand(
    organizationId: string,
    input: { brandId?: string; brandName?: string },
  ) {
    if (input.brandId) {
      const brand = await this.prisma.brand.findFirst({
        where: {
          organizationId,
          OR: [{ publicId: input.brandId }, { id: input.brandId }],
        },
      });
      if (!brand) {
        throw new AppError(
          'BRAND_NOT_FOUND',
          'Brand not found in this organization.',
          404,
        );
      }
      return brand;
    }
    const name = input.brandName?.trim();
    if (!name) {
      throw new AppError(
        'BRAND_REQUIRED',
        'Provide a brand id or brand name.',
        400,
      );
    }
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40);
    const existing = await this.prisma.brand.findFirst({
      where: { organizationId, OR: [{ slug }, { name }] },
    });
    if (existing) return existing;
    await this.billing.assertBrandQuota(organizationId);
    return this.prisma.brand.create({
      data: {
        publicId: publicId('brd'),
        organizationId,
        name,
        slug: slug || `brand-${Date.now().toString().slice(-4)}`,
        verificationStatus: BrandVerificationStatus.UNVERIFIED,
        status: BrandStatus.ACTIVE,
      },
    });
  }

  private async resolveVariant(
    organizationId: string,
    input: { variantId?: string; productId?: string },
  ) {
    if (input.variantId) {
      const variant = await this.prisma.productVariant.findFirst({
        where: { publicId: input.variantId, product: { organizationId } },
      });
      if (!variant) {
        throw new AppError('VARIANT_NOT_FOUND', 'Variant not found.', 404);
      }
      return variant;
    }
    if (input.productId) {
      const product = await this.prisma.product.findFirst({
        where: {
          organizationId,
          OR: [{ publicId: input.productId }, { id: input.productId }],
        },
        include: { variants: { orderBy: { createdAt: 'asc' } } },
      });
      if (!product) {
        throw new AppError('PRODUCT_NOT_FOUND', 'Product not found.', 404);
      }
      if (product.variants[0]) return product.variants[0];
      return this.prisma.productVariant.create({
        data: {
          publicId: publicId('var'),
          productId: product.id,
          name: 'Default',
          sku: `${product.sku}-DEF`,
        },
      });
    }
    throw new AppError(
      'VARIANT_REQUIRED',
      'Provide a variant id or product id.',
      400,
    );
  }

  private requireProductCode(
    raw: string | undefined,
    kind: 'gtin' | 'isbn',
  ): string | undefined {
    if (!raw?.trim()) return undefined;
    const normalized = normalizeProductCode(raw, kind);
    if (!normalized) {
      throw new AppError(
        kind === 'isbn' ? 'INVALID_ISBN' : 'INVALID_GTIN',
        kind === 'isbn'
          ? 'ISBN must be a valid ISBN-10 or ISBN-13 with a correct check digit.'
          : 'GTIN must be a valid EAN-8, UPC-A, EAN-13, or GTIN-14 with a correct check digit.',
        400,
      );
    }
    return normalized;
  }

  private async assertWritable(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (org) assertOrgWritable(org);
  }

  private async requireBrand(organizationId: string, brandPublicId: string) {
    const brand = await this.prisma.brand.findFirst({
      where: { organizationId, publicId: brandPublicId },
    });
    if (!brand) {
      throw new AppError('BRAND_NOT_FOUND', 'Brand not found.', 404);
    }
    return brand;
  }

  private mapProductStatus(raw?: string): ProductStatus | undefined {
    if (!raw) return undefined;
    const value = raw.toUpperCase();
    if ((Object.values(ProductStatus) as string[]).includes(value)) {
      return value as ProductStatus;
    }
    return undefined;
  }

  private mapCategory(raw: string): ProductCategory {
    const normalized = raw
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
    const allowed = Object.values(ProductCategory) as string[];
    if (allowed.includes(normalized)) {
      return normalized as ProductCategory;
    }
    const lowered = raw.toLowerCase();
    if (lowered.includes('pharma') || lowered.includes('drug')) {
      return ProductCategory.PHARMACEUTICAL;
    }
    if (lowered.includes('auto') || lowered.includes('spare')) {
      return ProductCategory.AUTOMOTIVE;
    }
    if (lowered.includes('cosmetic') || lowered.includes('beauty')) {
      return ProductCategory.COSMETICS;
    }
    if (lowered.includes('electronic')) return ProductCategory.ELECTRONICS;
    if (lowered.includes('food')) return ProductCategory.FOOD;
    if (lowered.includes('book') || lowered.includes('isbn')) {
      return ProductCategory.BOOKS;
    }
    if (lowered.includes('luxury')) return ProductCategory.LUXURY;
    return ProductCategory.OTHER;
  }

  private publicBrand(brand: {
    publicId: string;
    name: string;
    slug: string;
    verificationStatus: BrandVerificationStatus;
    status: BrandStatus;
  }) {
    return {
      id: brand.publicId,
      name: brand.name,
      slug: brand.slug,
      verificationStatus: brand.verificationStatus,
      status: brand.status,
    };
  }

  private publicProduct(
    product: {
      publicId: string;
      name: string;
      sku: string;
      gtin: string | null;
      isbn: string | null;
      category: ProductCategory;
      status: ProductStatus;
      countryOfOrigin: string;
    },
    brandId: string,
  ) {
    return {
      id: product.publicId,
      brandId,
      name: product.name,
      sku: product.sku,
      gtin: product.gtin,
      isbn: product.isbn,
      category: product.category,
      status: product.status,
      countryOfOrigin: product.countryOfOrigin,
    };
  }
}
