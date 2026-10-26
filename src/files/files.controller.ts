import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  StreamableFile,
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
import { FilePurpose, OrganizationMemberRole } from '@prisma/client';
import { ApiScopes, OrgRoles, Public } from '../common/decorators/auth.decorators';
import { OrganizationId } from '../common/decorators/current-user.decorator';
import { PartnerAuth } from '../common/decorators/partner-auth.decorator';
import { AppError } from '../common/errors/app-error';
import { UploadDto } from './dto/files.dto';
import { FilesService } from './files.service';

@ApiTags('files')
@Controller()
export class PublicFilesController {
  constructor(private readonly files: FilesService) {}

  @Public()
  @Get('public/files/:id')
  @ApiOperation({
    summary:
      'Public product image. Prefer the Cloudflare R2 URL when R2_PUBLIC_BASE_URL is set.',
  })
  @Header('Cache-Control', 'public, max-age=86400')
  async publicImage(@Param('id') id: string) {
    const { file, buffer } = await this.files.publicImage(id);
    return new StreamableFile(buffer, { type: file.mimeType });
  }
}

@ApiTags('files')
@PartnerAuth()
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @OrgRoles(
    OrganizationMemberRole.OWNER,
    OrganizationMemberRole.ADMIN,
    OrganizationMemberRole.MANAGER,
  )
  @ApiScopes('PRODUCT_WRITE')
  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'purpose'],
      properties: {
        file: { type: 'string', format: 'binary' },
        purpose: { type: 'string', enum: Object.values(FilePurpose) },
      },
    },
  })
  @ApiOperation({ summary: 'Upload a file to Cloudflare R2 (or local fallback)' })
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadDto,
    @OrganizationId() organizationId: string,
  ) {
    if (!file) {
      throw new AppError('INVALID_FILE', 'Choose a file to upload.', 400);
    }
    return this.files.store({
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalName: dto.originalName ?? file.originalname,
      purpose: dto.purpose,
      organizationId,
    });
  }
}
