import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiScope } from '../constants/api-scopes';
import { API_SCOPES_KEY, ORG_ROLES_KEY } from '../decorators/auth.decorators';
import type { RequestPrincipal } from '../types/request-principal';

@Injectable()
export class ApiScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      principal?: RequestPrincipal;
    }>();
    if (request.principal?.kind !== 'apiKey') return true;

    const required = this.reflector.getAllAndOverride<ApiScope[]>(
      API_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const orgRoles = this.reflector.getAllAndOverride<string[]>(ORG_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if ((!required || required.length === 0) && orgRoles?.length) {
      throw new ForbiddenException('This endpoint does not accept API keys.');
    }
    if (!required || required.length === 0) return true;

    const granted = new Set(request.principal.scopes);
    if (!required.some((scope) => granted.has(scope))) {
      throw new ForbiddenException(
        `API key is missing required scope: ${required.join(' or ')}.`,
      );
    }
    return true;
  }
}
