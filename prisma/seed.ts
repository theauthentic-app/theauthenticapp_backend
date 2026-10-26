import { PrismaClient, OrganizationType, ProductCategory, IdentityStatus, ScanSource, ClientPlatform, VerificationStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  credentialHint,
  normalizeCode,
  publicId,
  sha256,
  signIdentity,
} from '../src/common/utils/crypto.util';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await argon2.hash('authentic-demo');
  const signingSecret = process.env.IDENTITY_SIGNING_SECRET ?? 'dev-identity-hmac-secret-authentic';

  const admin = await prisma.user.upsert({
    where: { email: 'admin@authentic.local' },
    update: {},
    create: {
      publicId: publicId('usr'),
      email: 'admin@authentic.local',
      passwordHash,
      firstName: 'Platform',
      lastName: 'Admin',
      platformRole: 'SUPER_ADMIN',
      emailVerifiedAt: new Date(),
    },
  });

  const consumer = await prisma.user.upsert({
    where: { email: 'ibrahim@authentic.local' },
    update: {},
    create: {
      publicId: publicId('usr'),
      email: 'ibrahim@authentic.local',
      passwordHash,
      firstName: 'Ibrahim',
      lastName: 'Bello',
      emailVerifiedAt: new Date(),
    },
  });

  const manufacturerUser = await prisma.user.upsert({
    where: { email: 'ada@aurelia.local' },
    update: {},
    create: {
      publicId: publicId('usr'),
      email: 'ada@aurelia.local',
      passwordHash,
      firstName: 'Ada',
      lastName: 'Okonkwo',
      emailVerifiedAt: new Date(),
    },
  });

  const org = await prisma.organization.upsert({
    where: { slug: 'aurelia-beauty-demo' },
    update: {},
    create: {
      publicId: publicId('org'),
      name: 'Aurelia Beauty (demo)',
      slug: 'aurelia-beauty-demo',
      type: OrganizationType.MANUFACTURER,
      status: 'ACTIVE',
      country: 'NG',
      city: 'Lagos',
      legalName: 'Aurelia Beauty Limited',
      verifiedAt: new Date(),
    },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: manufacturerUser.id } },
    update: { role: 'OWNER' },
    create: { organizationId: org.id, userId: manufacturerUser.id, role: 'OWNER' },
  });

  const periodStart = new Date();
  const periodEnd = new Date(periodStart.getTime() + 30 * 86_400_000);
  await prisma.subscription.upsert({
    where: { organizationId: org.id },
    update: { planCode: 'GROWTH', status: 'ACTIVE' },
    create: {
      organizationId: org.id,
      planCode: 'GROWTH',
      status: 'ACTIVE',
      acceptedTermsVersion: '2026-09-10',
      acceptedTermsAt: periodStart,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    },
  });

  const brand = await prisma.brand.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: 'aurelia' } },
    update: {},
    create: {
      publicId: publicId('brd'),
      organizationId: org.id,
      name: 'Aurelia',
      slug: 'aurelia',
      verificationStatus: 'VERIFIED',
      status: 'ACTIVE',
    },
  });

  const product = await prisma.product.upsert({
    where: { organizationId_sku: { organizationId: org.id, sku: 'AUR-SER-30' } },
    update: {},
    create: {
      publicId: publicId('prd'),
      organizationId: org.id,
      brandId: brand.id,
      name: 'Radiance Repair Serum',
      sku: 'AUR-SER-30',
      gtin: '6151234567890',
      category: ProductCategory.COSMETICS,
      countryOfOrigin: 'NG',
      status: 'ACTIVE',
      description: 'DEMO seed product. Not a real commercial listing.',
    },
  });

  let variant = await prisma.productVariant.findFirst({
    where: { productId: product.id, sku: 'AUR-SER-30-UNIT' },
  });
  if (!variant) {
    variant = await prisma.productVariant.create({
      data: {
        publicId: publicId('var'),
        productId: product.id,
        name: '30ml bottle',
        sku: 'AUR-SER-30-UNIT',
      },
    });
  }

  let batch = await prisma.batch.findFirst({
    where: { organizationId: org.id, batchNumber: 'AUR-DEMO-001' },
  });
  if (!batch) {
    batch = await prisma.batch.create({
      data: {
        publicId: publicId('bat'),
        organizationId: org.id,
        productVariantId: variant.id,
        batchNumber: 'AUR-DEMO-001',
        manufacturingDate: new Date('2026-06-12'),
        expiryDate: new Date('2028-06-12'),
        quantity: 50,
      },
    });
  }

  const demoPublicId = 'pid_demoR8K2M19X';
  let identity = await prisma.productIdentity.findUnique({ where: { publicId: demoPublicId } });
  if (!identity) {
    identity = await prisma.productIdentity.create({
      data: {
        publicId: demoPublicId,
        serialNumber: 'R8K2M19X',
        organizationId: org.id,
        productVariantId: variant.id,
        batchId: batch.id,
        status: IdentityStatus.ACTIVE,
        activatedAt: new Date(),
        signature: 'pending',
      },
    });
    const signature = signIdentity({
      secret: signingSecret,
      publicId: identity.publicId,
      serialNumber: identity.serialNumber,
      variantSku: variant.sku,
      issuedAt: identity.createdAt.toISOString(),
    });
    identity = await prisma.productIdentity.update({
      where: { id: identity.id },
      data: { signature },
    });
    await prisma.credential.createMany({
      data: [
        {
          publicId: publicId('crd'),
          productIdentityId: identity.id,
          type: 'SERIAL',
          valueHash: sha256(normalizeCode(identity.serialNumber)),
          valueHint: credentialHint(identity.serialNumber),
        },
        {
          publicId: publicId('crd'),
          productIdentityId: identity.id,
          type: 'QR',
          valueHash: sha256(normalizeCode(identity.publicId)),
          valueHint: credentialHint(identity.publicId),
        },
      ],
    });
  }

  await prisma.verification.create({
    data: {
      publicId: publicId('ver'),
      productIdentityId: identity.id,
      status: VerificationStatus.AUTHENTICATED,
      trustScore: 96,
      reasons: ['DEMO seed verification in Lagos.'],
      signals: [],
      warnings: [],
      source: ScanSource.CAMERA,
      platform: ClientPlatform.ANDROID,
      city: 'Lagos',
      country: 'NG',
      latitude: 6.5244,
      longitude: 3.3792,
    },
  });

  console.log('Seeded AUTHENTIC demo data.');
  console.log('Admin:        admin@authentic.local / authentic-demo');
  console.log('Manufacturer: ada@aurelia.local / authentic-demo');
  console.log('Consumer:     ibrahim@authentic.local / authentic-demo');
  console.log('Demo identity:', demoPublicId);
  console.log('Admin user id (internal):', admin.id);
  console.log('Consumer user id (internal):', consumer.id);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
