import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import {
  parsePresentedCode,
  type PresentedCode,
} from '../common/utils/code-catalog.util';
import {
  emptyLookup,
  lookupPublicCatalog,
  type CatalogLookupResult,
} from './catalog-lookup.client';

export type { CatalogLookupResult } from './catalog-lookup.client';

const POSITIVE_TTL = 86_400;
const NEGATIVE_TTL = 600;

@Injectable()
export class CatalogLookupService {
  private readonly logger = new Logger(CatalogLookupService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async lookup(
    code: string | PresentedCode,
  ): Promise<CatalogLookupResult | null> {
    const parsed =
      typeof code === 'string' ? parsePresentedCode(code) : code;
    if (parsed.kind !== 'isbn' && parsed.kind !== 'gtin') return null;

    const cacheKey = `lookup:${parsed.kind}:${parsed.canonical}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as CatalogLookupResult;
      } catch {
        await this.redis.del(cacheKey);
      }
    }

    const result = await lookupPublicCatalog(parsed, {
      googleBooksApiKey: this.config.get<string>('GOOGLE_BOOKS_API_KEY'),
      upcitemdb: this.config.get('CATALOG_LOOKUP_UPCITEMDB') === 'true',
      onError: (url, error) =>
        this.logger.debug(`Catalog lookup failed for ${url}: ${String(error)}`),
    });

    const payload =
      result ??
      emptyLookup(parsed, parsed.kind === 'isbn' ? parsed.isbn13 : parsed.gtin);

    await this.redis.set(
      cacheKey,
      JSON.stringify(payload),
      payload.found ? POSITIVE_TTL : NEGATIVE_TTL,
    );
    return payload;
  }
}
