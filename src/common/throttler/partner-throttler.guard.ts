import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';
import type { AuthUser } from '../decorators/current-user.decorator';
import type { RequestPrincipal } from '../types/request-principal';

@Injectable()
export class PartnerThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const principal = req.principal as RequestPrincipal | undefined;
    if (principal?.kind === 'apiKey') return `key:${principal.apiKeyId}`;
    const user = req.user as AuthUser | undefined;
    if (user?.id) return `user:${user.id}`;
    return (req.ip as string | undefined) ?? 'anonymous';
  }

  protected async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    const req = requestProps.context.switchToHttp().getRequest<{
      principal?: RequestPrincipal;
      user?: AuthUser;
    }>();
    return super.handleRequest({
      ...requestProps,
      limit: this.resolveLimit(req),
    });
  }

  private resolveLimit(req: {
    principal?: RequestPrincipal;
    user?: AuthUser;
  }): number {
    if (req.principal?.kind === 'apiKey') {
      return Number(process.env.THROTTLE_API_KEY ?? 300);
    }
    if (req.user || req.principal?.kind === 'user') {
      return Number(process.env.THROTTLE_JWT ?? 120);
    }
    return Number(process.env.THROTTLE_PUBLIC ?? 60);
  }

  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ path?: string }>();
    if (req.path === '/health' || req.path === '/api/v1/health') return true;
    return super.shouldSkip(context);
  }
}
