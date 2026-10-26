import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
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
import {
  AttachCredentialDto,
  GenerateIdentitiesDto,
  IdentityActionDto,
} from './dto/identities.dto';
import { IdentityPrintService } from './identity-print.service';
import { ProductIdentitiesService } from './product-identities.service';

@ApiTags('identities')
@PartnerAuth()
@Controller('product-identities')
export class ProductIdentitiesController {
  constructor(
    private readonly identities: ProductIdentitiesService,
    private readonly labels: IdentityPrintService,
  ) {}

  @OrgRoles(
    OrganizationMemberRole.OWNER,
    OrganizationMemberRole.ADMIN,
    OrganizationMemberRole.MANAGER,
    OrganizationMemberRole.ANALYST,
    OrganizationMemberRole.VIEWER,
    OrganizationMemberRole.STAFF,
  )
  @ApiScopes('PRODUCT_READ')
  @Get()
  @ApiOperation({
    summary: 'List recent product identities for the organization',
  })
  list(
    @OrganizationId() organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.identities.list(organizationId, query);
  }

  @OrgRoles(
    OrganizationMemberRole.OWNER,
    OrganizationMemberRole.ADMIN,
    OrganizationMemberRole.MANAGER,
  )
  @ApiScopes('PRODUCT_WRITE')
  @Idempotent()
  @Post('generate')
  @ApiOperation({
    summary:
      'Bulk-generate unique product identities. Response includes verifyUrl, labelUrl, and CSV/PDF export links.',
  })
  generate(
    @OrganizationId() organizationId: string,
    @ActorId() actorId: string | undefined,
    @Body() dto: GenerateIdentitiesDto,
  ) {
    return this.identities.generate(organizationId, actorId, dto);
  }

  @OrgRoles(
    OrganizationMemberRole.OWNER,
    OrganizationMemberRole.ADMIN,
    OrganizationMemberRole.MANAGER,
  )
  @ApiScopes('PRODUCT_WRITE')
  @Idempotent()
  @Post('activate')
  @ApiOperation({ summary: 'Activate a generated identity' })
  activate(
    @OrganizationId() organizationId: string,
    @ActorId() actorId: string | undefined,
    @Body() dto: IdentityActionDto,
  ) {
    return this.identities.activate(organizationId, actorId, dto.identityId);
  }

  @OrgRoles(OrganizationMemberRole.OWNER, OrganizationMemberRole.ADMIN)
  @ApiScopes('PRODUCT_WRITE')
  @Post('revoke')
  @ApiOperation({ summary: 'Revoke an identity and its credentials' })
  revoke(
    @OrganizationId() organizationId: string,
    @ActorId() actorId: string | undefined,
    @Body() dto: IdentityActionDto,
  ) {
    return this.identities.revoke(organizationId, actorId, dto.identityId);
  }

  @OrgRoles(
    OrganizationMemberRole.OWNER,
    OrganizationMemberRole.ADMIN,
    OrganizationMemberRole.MANAGER,
  )
  @ApiScopes('PRODUCT_WRITE')
  @Post('credentials')
  @ApiOperation({
    summary:
      'Attach a unique manufacturer barcode, ISBN, Data Matrix, NFC, or RFID credential to one identity',
  })
  attachCredential(
    @OrganizationId() organizationId: string,
    @ActorId() actorId: string | undefined,
    @Body() dto: AttachCredentialDto,
  ) {
    return this.identities.attachCredential(organizationId, actorId, dto);
  }

  @OrgRoles(
    OrganizationMemberRole.OWNER,
    OrganizationMemberRole.ADMIN,
    OrganizationMemberRole.MANAGER,
    OrganizationMemberRole.STAFF,
  )
  @ApiScopes('PRODUCT_READ')
  @Get('export')
  @ApiOperation({
    summary: 'Download identities as CSV or a printable QR PDF pack',
  })
  async export(
    @OrganizationId() organizationId: string,
    @Query('format') format = 'csv',
    @Query('batchId') batchId?: string,
  ) {
    if (format === 'pdf') {
      const pdf = await this.labels.exportPdf(organizationId, batchId);
      return new StreamableFile(pdf, {
        type: 'application/pdf',
        disposition: 'attachment; filename="authentic-identities.pdf"',
      });
    }
    const csv = await this.labels.exportCsv(organizationId, batchId);
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="authentic-identities.csv"',
    });
  }

  @OrgRoles(
    OrganizationMemberRole.OWNER,
    OrganizationMemberRole.ADMIN,
    OrganizationMemberRole.MANAGER,
    OrganizationMemberRole.STAFF,
    OrganizationMemberRole.VIEWER,
  )
  @ApiScopes('PRODUCT_READ')
  @Get(':id/label')
  @Header('Content-Type', 'image/png')
  @ApiProduces('image/png')
  @ApiOperation({ summary: 'PNG QR label that opens the consumer verify page' })
  async label(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    const png = await this.labels.labelPng(organizationId, id);
    return new StreamableFile(png, { type: 'image/png' });
  }
}
