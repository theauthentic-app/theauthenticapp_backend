import { Injectable } from '@nestjs/common';
import { BlogPostStatus, Prisma } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { publicId } from '../common/utils/crypto.util';
import {
  paginatedResult,
  paginationOf,
  type PaginationInput,
} from '../common/utils/pagination.util';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import type { UpdateBlogPostDto, UpsertBlogPostDto } from './dto/blog.dto';

@Injectable()
export class BlogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listPublic(query?: PaginationInput & { tag?: string }) {
    const { page, limit, skip, take } = paginationOf(query);
    const where: Prisma.BlogPostWhereInput = {
      status: BlogPostStatus.PUBLISHED,
      ...(query?.tag ? { tags: { has: query.tag } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.blogPost.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip,
        take,
        select: this.listSelect(),
      }),
      this.prisma.blogPost.count({ where }),
    ]);
    return paginatedResult(
      rows.map((row) => this.toPublicCard(row)),
      total,
      page,
      limit,
    );
  }

  async getBySlug(slug: string, allowDraft = false) {
    const post = await this.prisma.blogPost.findUnique({
      where: { slug },
      include: {
        author: {
          select: { publicId: true, firstName: true, lastName: true },
        },
      },
    });
    if (!post) {
      throw new AppError('BLOG_NOT_FOUND', 'Post not found.', 404);
    }
    if (!allowDraft && post.status !== BlogPostStatus.PUBLISHED) {
      throw new AppError('BLOG_NOT_FOUND', 'Post not found.', 404);
    }
    return this.toDetail(post);
  }

  async adminList(query?: PaginationInput & { status?: BlogPostStatus }) {
    const { page, limit, skip, take } = paginationOf(query);
    const where: Prisma.BlogPostWhereInput = query?.status
      ? { status: query.status }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.blogPost.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
        include: {
          author: {
            select: { publicId: true, firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.blogPost.count({ where }),
    ]);
    return paginatedResult(
      rows.map((row) => ({
        ...this.toPublicCard(row),
        status: row.status,
        updatedAt: row.updatedAt,
      })),
      total,
      page,
      limit,
    );
  }

  async create(actorUserId: string, dto: UpsertBlogPostDto) {
    await this.assertSlugFree(dto.slug);
    const status = dto.status ?? BlogPostStatus.DRAFT;
    const post = await this.prisma.blogPost.create({
      data: {
        publicId: publicId('blg'),
        slug: dto.slug,
        title: dto.title,
        excerpt: dto.excerpt,
        bodyMarkdown: dto.bodyMarkdown,
        coverImageUrl: dto.coverImageUrl,
        status,
        seoTitle: dto.seoTitle ?? dto.title,
        seoDescription: dto.seoDescription ?? dto.excerpt,
        tags: dto.tags ?? [],
        authorUserId: actorUserId,
        publishedAt: status === BlogPostStatus.PUBLISHED ? new Date() : null,
      },
    });
    if (status === BlogPostStatus.PUBLISHED) {
      await this.audit.record({
        action: 'BLOG_PUBLISHED',
        actorUserId,
        entity: 'BlogPost',
        entityId: post.id,
        metadata: { slug: post.slug },
      });
    }
    return this.getBySlug(post.slug, true);
  }

  async update(actorUserId: string, idOrSlug: string, dto: UpdateBlogPostDto) {
    const existing = await this.findAdmin(idOrSlug);
    if (dto.slug && dto.slug !== existing.slug) {
      await this.assertSlugFree(dto.slug);
    }
    const nextStatus = dto.status ?? existing.status;
    const publishedAt =
      nextStatus === BlogPostStatus.PUBLISHED
        ? (existing.publishedAt ?? new Date())
        : existing.publishedAt;

    const post = await this.prisma.blogPost.update({
      where: { id: existing.id },
      data: {
        slug: dto.slug,
        title: dto.title,
        excerpt: dto.excerpt,
        bodyMarkdown: dto.bodyMarkdown,
        coverImageUrl: dto.coverImageUrl,
        status: dto.status,
        seoTitle: dto.seoTitle,
        seoDescription: dto.seoDescription,
        tags: dto.tags,
        publishedAt,
      },
    });

    if (
      nextStatus === BlogPostStatus.PUBLISHED &&
      existing.status !== BlogPostStatus.PUBLISHED
    ) {
      await this.audit.record({
        action: 'BLOG_PUBLISHED',
        actorUserId,
        entity: 'BlogPost',
        entityId: post.id,
        metadata: { slug: post.slug },
      });
    }
    return this.getBySlug(post.slug, true);
  }

  async remove(_actorUserId: string, idOrSlug: string) {
    const existing = await this.findAdmin(idOrSlug);
    await this.prisma.blogPost.delete({ where: { id: existing.id } });
    return { deleted: true, id: existing.publicId };
  }

  private async findAdmin(idOrSlug: string) {
    const post = await this.prisma.blogPost.findFirst({
      where: {
        OR: [{ publicId: idOrSlug }, { slug: idOrSlug }, { id: idOrSlug }],
      },
    });
    if (!post) {
      throw new AppError('BLOG_NOT_FOUND', 'Post not found.', 404);
    }
    return post;
  }

  private async assertSlugFree(slug: string) {
    const clash = await this.prisma.blogPost.findUnique({ where: { slug } });
    if (clash) {
      throw new AppError('SLUG_IN_USE', 'That blog slug is already taken.', 409);
    }
  }

  private listSelect() {
    return {
      publicId: true,
      slug: true,
      title: true,
      excerpt: true,
      coverImageUrl: true,
      seoTitle: true,
      seoDescription: true,
      tags: true,
      publishedAt: true,
      createdAt: true,
      author: {
        select: { publicId: true, firstName: true, lastName: true },
      },
    } satisfies Prisma.BlogPostSelect;
  }

  private toPublicCard(row: {
    publicId: string;
    slug: string;
    title: string;
    excerpt: string | null;
    coverImageUrl: string | null;
    seoTitle?: string | null;
    seoDescription?: string | null;
    tags: string[];
    publishedAt: Date | null;
    createdAt: Date;
    author?: {
      publicId: string;
      firstName: string;
      lastName: string;
    } | null;
  }) {
    return {
      id: row.publicId,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      coverImageUrl: row.coverImageUrl,
      seoTitle: row.seoTitle ?? row.title,
      seoDescription: row.seoDescription ?? row.excerpt,
      tags: row.tags,
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
      author: row.author
        ? {
            id: row.author.publicId,
            name: `${row.author.firstName} ${row.author.lastName}`.trim(),
          }
        : null,
    };
  }

  private toDetail(post: {
    publicId: string;
    slug: string;
    title: string;
    excerpt: string | null;
    bodyMarkdown: string;
    coverImageUrl: string | null;
    status: BlogPostStatus;
    seoTitle: string | null;
    seoDescription: string | null;
    tags: string[];
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    author?: {
      publicId: string;
      firstName: string;
      lastName: string;
    } | null;
  }) {
    return {
      ...this.toPublicCard(post),
      bodyMarkdown: post.bodyMarkdown,
      status: post.status,
      updatedAt: post.updatedAt,
    };
  }
}
