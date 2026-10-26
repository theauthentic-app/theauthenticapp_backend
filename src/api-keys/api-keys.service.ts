import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { API_SCOPES } from '../common/constants/api-scopes';
import { AppError } from '../common/errors/app-error';
import { randomToken } from '../common/utils/crypto.util';
import {
  paginatedResult,
  paginationOf,
  type PaginationInput,
} from '../common/utils/pagination.util';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    organizationId: string,
    actorUserId: string | undefined,
    input: { name: string; scopes: string[]; expiresAt?: string },
  ) {
    const invalid = input.scopes.filter(
      (s) => !API_SCOPES.includes(s as (typeof API_SCOPES)[number]),
    );
    if (invalid.length)
      throw new AppError(
        'INVALID_SCOPE',
        'One or more API key scopes are invalid.',
        400,
      );
    const secret = `atk_live_${randomToken(24)}`;
    const prefix = secret.slice(0, 16);
    const secretHash = await argon2.hash(secret);
    const key = await this.prisma.apiKey.create({
      data: {
        organizationId,
        name: input.name,
        prefix,
        secretHash,
        scopes: input.scopes,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    });
    await this.audit.record({
      action: 'API_KEY_CREATED',
      actorUserId,
      organizationId,
      entity: 'ApiKey',
      entityId: key.id,
    });
    return { id: key.id, prefix, secret, scopes: key.scopes };
  }

  async list(organizationId: string, query?: PaginationInput) {
    const { page, limit, skip, take } = paginationOf(query);
    const where = { organizationId };
    const [keys, total] = await this.prisma.$transaction([
      this.prisma.apiKey.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.apiKey.count({ where }),
    ]);
    return paginatedResult(
      keys.map((key) => ({
        id: key.id,
        name: key.name,
        prefix: key.prefix,
        scopes: key.scopes,
        status: key.status,
        lastUsedAt: key.lastUsedAt,
        createdAt: key.createdAt,
      })),
      total,
      page,
      limit,
    );
  }

  async revoke(
    organizationId: string,
    actorUserId: string | undefined,
    id: string,
  ) {
    const key = await this.prisma.apiKey.findFirst({
      where: { id, organizationId },
    });
    if (!key)
      throw new AppError('API_KEY_NOT_FOUND', 'API key not found.', 404);
    await this.prisma.apiKey.update({
      where: { id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    await this.audit.record({
      action: 'API_KEY_REVOKED',
      actorUserId,
      organizationId,
      entity: 'ApiKey',
      entityId: id,
    });
    return { revoked: true };
  }

  async verify(raw: string) {
    const prefix = raw.slice(0, 16);
    const candidates = await this.prisma.apiKey.findMany({
      where: { prefix, status: 'ACTIVE' },
    });
    for (const candidate of candidates) {
      if (candidate.expiresAt && candidate.expiresAt < new Date()) continue;
      const ok = await argon2.verify(candidate.secretHash, raw);
      if (ok) {
        await this.prisma.apiKey.update({
          where: { id: candidate.id },
          data: { lastUsedAt: new Date() },
        });
        return candidate;
      }
    }
    return null;
  }
}
