import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { Observable, lastValueFrom } from 'rxjs';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { IS_PUBLIC_KEY } from '../decorators/auth.decorators';
import type { AuthUser } from '../decorators/current-user.decorator';
import type { RequestPrincipal } from '../types/request-principal';
import { extractApiKey } from './api-key.auth';

type AuthedRequest = Request & {
  user?: AuthUser;
  principal?: RequestPrincipal;
  organizationId?: string;
};

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeysService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const rawKey = extractApiKey(request);

    if (rawKey) {
      const key = await this.apiKeys.verify(rawKey);
      if (!key) {
        throw new UnauthorizedException('Invalid API key.');
      }
      request.principal = {
        kind: 'apiKey',
        apiKeyId: key.id,
        organizationId: key.organizationId,
        scopes: key.scopes,
      };
      request.organizationId = key.organizationId;
      return true;
    }

    try {
      const result = super.canActivate(context);
      const ok =
        result instanceof Observable
          ? await lastValueFrom(result)
          : await result;
      if (ok && request.user) {
        request.principal = { kind: 'user', user: request.user };
      }
      return Boolean(ok) || isPublic;
    } catch {
      if (isPublic) return true;
      throw new UnauthorizedException();
    }
  }
}
