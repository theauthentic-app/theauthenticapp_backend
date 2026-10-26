import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLATFORM_ROLES_KEY } from '../decorators/auth.decorators';
import { AuthUser } from '../decorators/current-user.decorator';
import type { RequestPrincipal } from '../types/request-principal';

@Injectable()
export class PlatformRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(
      PLATFORM_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles || roles.length === 0) return true;
    const request = context.switchToHttp().getRequest<{
      user?: AuthUser;
      principal?: RequestPrincipal;
    }>();
    if (request.principal?.kind === 'apiKey') {
      throw new ForbiddenException('Administrator access required.');
    }
    const user = request.user;
    if (!user || !roles.includes(user.platformRole)) {
      throw new ForbiddenException('Administrator access required.');
    }
    return true;
  }
}
