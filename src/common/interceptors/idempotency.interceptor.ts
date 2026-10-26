import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../database/prisma.service';
import { IDEMPOTENT_KEY } from '../decorators/auth.decorators';

const TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const enabled = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!enabled) return next.handle();

    const request = context.switchToHttp().getRequest<
      Request & { organizationId?: string }
    >();
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !key.trim()) return next.handle();

    const method = request.method.toUpperCase();
    const path = request.originalUrl.split('?')[0] ?? request.path;
    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { key_method_path: { key: key.trim(), method, path } },
    });
    if (existing) {
      const age = Date.now() - existing.createdAt.getTime();
      if (age <= TTL_MS) {
        return of(existing.responseBody);
      }
    }

    return next.handle().pipe(
      tap(async (body) => {
        try {
          await this.prisma.idempotencyKey.create({
            data: {
              key: key.trim(),
              organizationId: request.organizationId,
              method,
              path,
              responseCode: 201,
              responseBody: body as Prisma.InputJsonValue,
            },
          });
        } catch {
          // Unique race: another request stored the same key; ignore.
        }
      }),
    );
  }
}
