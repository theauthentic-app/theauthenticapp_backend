import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganizationMemberRole } from '@prisma/client';
import {
  ApiScopes,
  Idempotent,
  OrgRoles,
} from '../common/decorators/auth.decorators';
import {
  ActorId,
  OrganizationId,
} from '../common/decorators/current-user.decorator';
import { PartnerAuth } from '../common/decorators/partner-auth.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { BillingService } from '../billing/billing.service';
import { ApiKeysService } from './api-keys.service';
import {
  CreateApiKeyDto,
  CreateWebhookDto,
  UpdateWebhookDto,
} from './dto/platform.dto';
import { WebhooksService } from '../webhooks/webhooks.service';

@ApiTags('platform')
@PartnerAuth()
@Controller()
export class PlatformController {
  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly webhooks: WebhooksService,
    private readonly billing: BillingService,
  ) {}

  @OrgRoles(
    OrganizationMemberRole.OWNER,
    OrganizationMemberRole.ADMIN,
    OrganizationMemberRole.MANAGER,
    OrganizationMemberRole.VIEWER,
  )
  @ApiScopes('WEBHOOKS')
  @Get('api-keys')
  @ApiOperation({ summary: 'List API keys (secret is never returned again)' })
  listKeys(
    @OrganizationId() organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.apiKeys.list(organizationId, query);
  }

  @OrgRoles(OrganizationMemberRole.OWNER, OrganizationMemberRole.ADMIN)
  @ApiScopes('WEBHOOKS')
  @Post('api-keys')
  @ApiOperation({ summary: 'Create an API key. The secret is shown once.' })
  async createKey(
    @OrganizationId() organizationId: string,
    @ActorId() actorId: string | undefined,
    @Body() dto: CreateApiKeyDto,
  ) {
    await this.billing.assertFeature(organizationId, 'apiKeys');
    return this.apiKeys.create(organizationId, actorId, dto);
  }

  @OrgRoles(OrganizationMemberRole.OWNER, OrganizationMemberRole.ADMIN)
  @ApiScopes('WEBHOOKS')
  @Delete('api-keys/:id')
  @ApiOperation({ summary: 'Revoke an API key' })
  revokeKey(
    @OrganizationId() organizationId: string,
    @ActorId() actorId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.apiKeys.revoke(organizationId, actorId, id);
  }

  @OrgRoles(
    OrganizationMemberRole.OWNER,
    OrganizationMemberRole.ADMIN,
    OrganizationMemberRole.MANAGER,
  )
  @ApiScopes('WEBHOOKS')
  @Get('webhooks')
  @ApiOperation({ summary: 'List webhook endpoints' })
  listWebhooks(
    @OrganizationId() organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.webhooks.list(organizationId, query);
  }

  @OrgRoles(OrganizationMemberRole.OWNER, OrganizationMemberRole.ADMIN)
  @ApiScopes('WEBHOOKS')
  @Idempotent()
  @Post('webhooks')
  @ApiOperation({
    summary: 'Register a signed webhook endpoint. The signing secret is shown once.',
  })
  async createWebhook(
    @OrganizationId() organizationId: string,
    @Body() dto: CreateWebhookDto,
  ) {
    await this.billing.assertFeature(organizationId, 'webhooks');
    return this.webhooks.createEndpoint(organizationId, dto);
  }

  @OrgRoles(OrganizationMemberRole.OWNER, OrganizationMemberRole.ADMIN)
  @ApiScopes('WEBHOOKS')
  @Patch('webhooks/:id')
  @ApiOperation({ summary: 'Pause, disable, or reactivate a webhook' })
  updateWebhook(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhooks.updateEndpoint(organizationId, id, dto);
  }

  @OrgRoles(OrganizationMemberRole.OWNER, OrganizationMemberRole.ADMIN)
  @ApiScopes('WEBHOOKS')
  @Delete('webhooks/:id')
  @ApiOperation({ summary: 'Delete a webhook endpoint' })
  deleteWebhook(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.webhooks.deleteEndpoint(organizationId, id);
  }

  @OrgRoles(
    OrganizationMemberRole.OWNER,
    OrganizationMemberRole.ADMIN,
    OrganizationMemberRole.MANAGER,
  )
  @ApiScopes('WEBHOOKS')
  @Get('webhooks/:id/deliveries')
  @ApiOperation({ summary: 'List deliveries for a webhook endpoint' })
  listDeliveries(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.webhooks.listDeliveries(organizationId, id, query);
  }

  @OrgRoles(OrganizationMemberRole.OWNER, OrganizationMemberRole.ADMIN)
  @ApiScopes('WEBHOOKS')
  @Post('webhooks/deliveries/:id/retry')
  @ApiOperation({ summary: 'Re-queue a webhook delivery' })
  retryDelivery(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.webhooks.retryDelivery(organizationId, id);
  }
}
