import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import { buildSwaggerConfig } from '../src/common/config/swagger.config';
import {
  ApiErrorResponse,
  ApiSuccessResponse,
} from '../src/common/dto/api-envelope.dto';
import { PaginatedMeta } from '../src/common/dto/pagination.dto';

process.env.OPENAPI_EXPORT = 'true';

async function exportOpenApi() {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  const document = SwaggerModule.createDocument(app, buildSwaggerConfig(), {
    extraModels: [ApiSuccessResponse, ApiErrorResponse, PaginatedMeta],
  });
  const outDir = join(process.cwd(), 'docs');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'openapi.json');
  writeFileSync(outFile, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outFile}`);
}

void exportOpenApi().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
