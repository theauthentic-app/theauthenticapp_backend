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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { BlogPostStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import {
  HumanOnly,
  PlatformRoles,
  Public,
} from '../common/decorators/auth.decorators';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { BlogService } from './blog.service';
import { UpdateBlogPostDto, UpsertBlogPostDto } from './dto/blog.dto';

class PublicBlogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tag?: string;
}

class AdminBlogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: BlogPostStatus })
  @IsOptional()
  @IsEnum(BlogPostStatus)
  status?: BlogPostStatus;
}

@ApiTags('blog')
@Controller()
export class BlogController {
  constructor(private readonly blog: BlogService) {}

  @Public()
  @Get('public/blog')
  @ApiOperation({ summary: 'List published blog posts (SEO / marketing)' })
  listPublic(@Query() query: PublicBlogQueryDto) {
    return this.blog.listPublic(query);
  }

  @Public()
  @Get('public/blog/:slug')
  @ApiOperation({ summary: 'Get a published post by slug' })
  getPublic(@Param('slug') slug: string) {
    return this.blog.getBySlug(slug, false);
  }

  @ApiBearerAuth('bearer')
  @HumanOnly()
  @PlatformRoles('ADMIN', 'SUPER_ADMIN')
  @Get('admin/blog')
  @ApiOperation({ summary: 'Admin: list all blog posts' })
  adminList(@Query() query: AdminBlogQueryDto) {
    return this.blog.adminList(query);
  }

  @ApiBearerAuth('bearer')
  @HumanOnly()
  @PlatformRoles('ADMIN', 'SUPER_ADMIN')
  @Post('admin/blog')
  @ApiOperation({ summary: 'Admin: create a blog post' })
  create(@CurrentUser() user: AuthUser, @Body() dto: UpsertBlogPostDto) {
    return this.blog.create(user.id, dto);
  }

  @ApiBearerAuth('bearer')
  @HumanOnly()
  @PlatformRoles('ADMIN', 'SUPER_ADMIN')
  @Patch('admin/blog/:id')
  @ApiOperation({ summary: 'Admin: update a blog post (id, publicId, or slug)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateBlogPostDto,
  ) {
    return this.blog.update(user.id, id, dto);
  }

  @ApiBearerAuth('bearer')
  @HumanOnly()
  @PlatformRoles('ADMIN', 'SUPER_ADMIN')
  @Delete('admin/blog/:id')
  @ApiOperation({ summary: 'Admin: delete a blog post' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.blog.remove(user.id, id);
  }
}
