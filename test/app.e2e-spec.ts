import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { RequestContextInterceptor } from '../src/common/interceptors/request-context.interceptor';

describe('AUTHENTIC e2e (requires Postgres + Redis)', () => {
  let app: INestApplication;
  const enabled = Boolean(process.env.DATABASE_URL);

  beforeAll(async () => {
    if (!enabled) return;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new RequestContextInterceptor());
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('registers, creates catalog, generates identity, verifies, then flags impossible travel', async () => {
    if (!enabled) {
      expect(true).toBe(true);
      return;
    }

    const email = `e2e-${Date.now()}@authentic.test`;
    const register = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'super-secret-1',
        firstName: 'Ada',
        lastName: 'Okonkwo',
        organizationName: 'E2E Beauty',
      })
      .expect(201);

    const token = register.body.data.accessToken as string;
    const orgs = await request(app.getHttpServer())
      .get('/api/v1/organizations')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const orgId = orgs.body.data[0].id as string;

    const brand = await request(app.getHttpServer())
      .post('/api/v1/brands')
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', orgId)
      .send({ name: 'E2E Brand' })
      .expect(201);

    const product = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', orgId)
      .send({
        brandId: brand.body.data.id,
        name: 'Serum',
        sku: 'E2E-SER-1',
        category: 'COSMETICS',
      })
      .expect(201);

    const variant = await request(app.getHttpServer())
      .post('/api/v1/product-variants')
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', orgId)
      .send({
        productId: product.body.data.id,
        name: '30ml',
        sku: 'E2E-SER-1-30',
      })
      .expect(201);

    const batch = await request(app.getHttpServer())
      .post('/api/v1/batches')
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', orgId)
      .send({
        variantId: variant.body.data.id,
        batchNumber: 'E2E-001',
        manufacturingDate: '2026-01-01',
        quantity: 10,
      })
      .expect(201);

    const generated = await request(app.getHttpServer())
      .post('/api/v1/product-identities/generate')
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', orgId)
      .send({ batchId: batch.body.data.id, count: 1 })
      .expect(201);

    const identityId = generated.body.data.identities[0].publicId as string;
    await request(app.getHttpServer())
      .post('/api/v1/product-identities/activate')
      .set('Authorization', `Bearer ${token}`)
      .set('x-organization-id', orgId)
      .send({ identityId })
      .expect(201);

    const first = await request(app.getHttpServer())
      .post('/api/v1/public/verify')
      .send({
        code: identityId,
        source: 'CAMERA',
        city: 'Lagos',
        country: 'NG',
        latitude: 6.5244,
        longitude: 3.3792,
      })
      .expect(201);
    expect(first.body.data.status).toBe('AUTHENTICATED');

    const second = await request(app.getHttpServer())
      .post('/api/v1/public/verify')
      .send({
        code: identityId,
        source: 'CAMERA',
        city: 'London',
        country: 'GB',
        latitude: 51.5074,
        longitude: -0.1278,
      })
      .expect(201);
    expect(['SUSPICIOUS', 'COMPROMISED']).toContain(second.body.data.status);
  });
});
