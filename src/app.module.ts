import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './common/config/env.validation';
import { ApiScopesGuard } from './common/guards/api-scopes.guard';
import { HumanOnlyGuard } from './common/guards/human-only.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { OrgRolesGuard } from './common/guards/org-roles.guard';
import { PlatformRolesGuard } from './common/guards/platform-roles.guard';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { PartnerThrottlerGuard } from './common/throttler/partner-throttler.guard';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage';
import { ConsumersModule } from './consumers/consumers.module';
import { BillingModule } from './billing/billing.module';
import { DatabaseModule } from './database/database.module';
import { FilesModule } from './files/files.module';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { ProductIdentitiesModule } from './product-identities/product-identities.module';
import { ProductsModule } from './products/products.module';
import { RecallsModule } from './recalls/recalls.module';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';
import { ReportsModule } from './reports/reports.module';
import { RiskModule } from './risk/risk.module';
import { SupplyChainModule } from './supply-chain/supply-chain.module';
import { VerificationModule } from './verification/verification.module';
import { WarrantiesModule } from './warranties/warranties.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    RedisModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, RedisModule],
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ ttl: 60_000, limit: 60 }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    HealthModule,
    AuthModule,
    OrganizationsModule,
    ProductsModule,
    ProductIdentitiesModule,
    VerificationModule,
    ReportsModule,
    RecallsModule,
    WarrantiesModule,
    SupplyChainModule,
    AdminModule,
    AnalyticsModule,
    ApiKeysModule,
    FilesModule,
    NotificationsModule,
    AuditModule,
    RiskModule,
    ConsumersModule,
    BillingModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: HumanOnlyGuard },
    { provide: APP_GUARD, useClass: OrgRolesGuard },
    { provide: APP_GUARD, useClass: ApiScopesGuard },
    { provide: APP_GUARD, useClass: PlatformRolesGuard },
    { provide: APP_GUARD, useClass: PartnerThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}
