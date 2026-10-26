import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import express from 'express';
import helmet from 'helmet';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { buildSwaggerConfig } from './common/config/swagger.config';
import { ApiErrorResponse, ApiSuccessResponse } from './common/dto/api-envelope.dto';
import { PaginatedMeta } from './common/dto/pagination.dto';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { RequestContextInterceptor } from './common/interceptors/request-context.interceptor';
import { JsonLogger } from './common/logging/json.logger';
import { HealthService } from './health/health.service';
import { RedisService } from './redis/redis.service';

function swaggerEnabled() {
  return process.env.SWAGGER_ENABLED !== 'false';
}

async function bootstrap() {
  const jsonLogs = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
    logger: jsonLogs ? new JsonLogger() : undefined,
  });
  const logger = new Logger('AUTHENTIC');

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:3001')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  const publicRoot = join(process.cwd(), 'public');
  app.use('/app', express.static(join(publicRoot, 'app')));
  app.use('/scan', express.static(join(publicRoot, 'scan')));

  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new RequestContextInterceptor());

  if (swaggerEnabled()) {
    const document = SwaggerModule.createDocument(app, buildSwaggerConfig(), {
      extraModels: [ApiSuccessResponse, ApiErrorResponse, PaginatedMeta],
    });
    SwaggerModule.setup('docs', app, document, {
      jsonDocumentUrl: 'docs-json',
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const redis = app.get(RedisService);
  await redis.connect();

  const expressApp = app.getHttpAdapter().getInstance() as {
    get: (
      path: string,
      handler: (
        req: unknown,
        res: { json: (body: unknown) => void },
      ) => Promise<void>,
    ) => void;
  };
  const health = app.get(HealthService);
  expressApp.get('/health', async (_req, res) => {
    const data = await health.check();
    res.json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  logger.log(`AUTHENTIC API listening on ${port}`);
  logger.log(`Manufacturer app http://localhost:${port}/app`);
  logger.log(`Consumer scan http://localhost:${port}/scan`);
  if (swaggerEnabled()) {
    logger.log(`OpenAPI UI at http://localhost:${port}/docs`);
  }
}

void bootstrap();
