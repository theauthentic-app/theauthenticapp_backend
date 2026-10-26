import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { OrganizationMemberRole } from '@prisma/client';
import {
  ApiScopes,
  OrgRoles,
  Public,
} from '../common/decorators/auth.decorators';
import {
  ActorId,
  OrganizationId,
} from '../common/decorators/current-user.decorator';
import { PartnerAuth } from '../common/decorators/partner-auth.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { AppError } from '../common/errors/app-error';
import { CatalogService } from './catalog.service';
import {
  CreateBatchDto,
  CreateBrandDto,
  CreateProductDto,
  CreateVariantDto,
  UpdateBatchDto,
  UpdateBrandDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './dto/catalog.dto';

const CATALOG_READ = [
  OrganizationMemberRole.OWNER,
  OrganizationMemberRole.ADMIN,
  OrganizationMemberRole.MANAGER,
  OrganizationMemberRole.ANALYST,
  OrganizationMemberRole.VIEWER,
  OrganizationMemberRole.STAFF,
] as const;

const CATALOG_WRITE = [
  OrganizationMemberRole.OWNER,
  OrganizationMemberRole.ADMIN,
  OrganizationMemberRole.MANAGER,
] as const;

@ApiTags('catalog')
@PartnerAuth()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @OrgRoles(...CATALOG_WRITE)
  @ApiScopes('PRODUCT_WRITE')
  @Post('brands')
  @ApiOperation({ summary: 'Create a brand' })
  createBrand(
    @OrganizationId() organizationId: string,
    @ActorId() actorId: string | undefined,
    @Body() dto: CreateBrandDto,
  ) {
    return this.catalog.createBrand(organizationId, actorId, dto);
  }

  @OrgRoles(...CATALOG_READ)
  @ApiScopes('PRODUCT_READ')
  @Get('brands')
  @ApiOperation({ summary: 'List brands' })
  listBrands(
    @OrganizationId() organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.catalog.listBrands(organizationId, query);
  }

  @OrgRoles(...CATALOG_WRITE)
  @ApiScopes('PRODUCT_WRITE')
  @Post('products')
  @ApiOperation({ summary: 'Create a product' })
  createProduct(
    @OrganizationId() organizationId: string,
    @ActorId() actorId: string | undefined,
    @Body() dto: CreateProductDto,
  ) {
    return this.catalog.createProduct(organizationId, actorId, dto);
  }

  @OrgRoles(...CATALOG_READ)
  @ApiScopes('PRODUCT_READ')
  @Get('products')
  @ApiOperation({ summary: 'List products' })
  listProducts(
    @OrganizationId() organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.catalog.listProducts(organizationId, query);
  }

  @OrgRoles(...CATALOG_READ)
  @ApiScopes('PRODUCT_READ')
  @Get('batches')
  @ApiOperation({ summary: 'List batches' })
  listBatches(
    @OrganizationId() organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.catalog.listBatches(organizationId, query);
  }

  @Public()
  @Get('products/:id')
  @ApiOperation({ summary: 'Public product record by public id' })
  getProduct(@Param('id') id: string) {
    return this.catalog.getProduct(id);
  }

  @OrgRoles(...CATALOG_WRITE)
  @ApiScopes('PRODUCT_WRITE')
  @Post('products/:id/images')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Upload a product image to Cloudflare R2 or local storage',
  })
  uploadProductImage(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new AppError('INVALID_FILE', 'Choose an image to upload.', 400);
    }
    return this.catalog.attachProductImage(organizationId, id, {
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
    });
  }

  @OrgRoles(...CATALOG_WRITE)
  @ApiScopes('PRODUCT_WRITE')
  @Post('product-variants')
  @ApiOperation({ summary: 'Create a product variant' })
  createVariant(
    @OrganizationId() organizationId: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.catalog.createVariant(organizationId, dto);
  }

  @OrgRoles(...CATALOG_WRITE)
  @ApiScopes('PRODUCT_WRITE')
  @Post('batches')
  @ApiOperation({ summary: 'Create a manufacturing batch' })
  createBatch(
    @OrganizationId() organizationId: string,
    @ActorId() actorId: string | undefined,
    @Body() dto: CreateBatchDto,
  ) {
    return this.catalog.createBatch(organizationId, actorId, dto);
  }

  @OrgRoles(...CATALOG_WRITE)
  @ApiScopes('PRODUCT_WRITE')
  @Patch('brands/:id')
  @ApiOperation({ summary: 'Update a brand' })
  updateBrand(
    @OrganizationId() organizationId: string,
    @ActorId() actorId: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateBrandDto,
  ) {
    return this.catalog.updateBrand(organizationId, id, actorId, dto);
  }

  @OrgRoles(...CATALOG_WRITE)
  @ApiScopes('PRODUCT_WRITE')
  @Delete('brands/:id')
  @ApiOperation({ summary: 'Delete a brand, or archive it if products exist' })
  deleteBrand(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.catalog.deleteBrand(organizationId, id);
  }

  @OrgRoles(...CATALOG_WRITE)
  @ApiScopes('PRODUCT_WRITE')
  @Patch('products/:id')
  @ApiOperation({ summary: 'Update a product' })
  updateProduct(
    @OrganizationId() organizationId: string,
    @ActorId() actorId: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.catalog.updateProduct(organizationId, id, actorId, dto);
  }

  @OrgRoles(...CATALOG_WRITE)
  @ApiScopes('PRODUCT_WRITE')
  @Delete('products/:id')
  @ApiOperation({
    summary: 'Delete a product, or archive it if identities exist',
  })
  deleteProduct(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.catalog.deleteProduct(organizationId, id);
  }

  @OrgRoles(...CATALOG_WRITE)
  @ApiScopes('PRODUCT_WRITE')
  @Patch('product-variants/:id')
  @ApiOperation({ summary: 'Update a product variant' })
  updateVariant(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.catalog.updateVariant(organizationId, id, dto);
  }

  @OrgRoles(...CATALOG_WRITE)
  @ApiScopes('PRODUCT_WRITE')
  @Delete('product-variants/:id')
  @ApiOperation({ summary: 'Delete a variant that has no identities' })
  deleteVariant(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.catalog.deleteVariant(organizationId, id);
  }

  @OrgRoles(...CATALOG_WRITE)
  @ApiScopes('PRODUCT_WRITE')
  @Patch('batches/:id')
  @ApiOperation({ summary: 'Update a batch' })
  updateBatch(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBatchDto,
  ) {
    return this.catalog.updateBatch(organizationId, id, dto);
  }
}
