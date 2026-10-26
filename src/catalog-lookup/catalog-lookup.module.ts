import { Module } from '@nestjs/common';
import { CatalogLookupService } from './catalog-lookup.service';

@Module({
  providers: [CatalogLookupService],
  exports: [CatalogLookupService],
})
export class CatalogLookupModule {}
