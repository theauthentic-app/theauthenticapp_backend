import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HUMAN_ONLY_KEY } from '../decorators/auth.decorators';
import type { AuthUser } from '../decorators/current-user.decorator';
import type { RequestPrincipal } from '../types/request-principal';

@Injectable()
export class HumanOnlyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(HUMAN_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<{
      user?: AuthUser;
      principal?: RequestPrincipal;
    }>();
    if (request.principal?.kind === 'apiKey') {
      throw new ForbiddenException('This endpoint requires a user session.');
    }
    if (!request.user) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
