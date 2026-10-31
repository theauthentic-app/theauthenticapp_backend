import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { OrganizationMemberRole } from '@prisma/client';
import type { RequestPrincipal } from '../types/request-principal';

export type AuthUser = {
  id: string;
  email: string;
  platformRole: string;
};

type AuthedRequest = {
  user?: AuthUser;
  principal?: RequestPrincipal;
  organizationId?: string;
  membershipRole?: OrganizationMemberRole;
  headers: Record<string, string | undefined>;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const request = ctx.switchToHttp().getRequest<AuthedRequest>();
    return request.user;
  },
);

export const ActorId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (request.principal?.kind === 'user') return request.principal.user.id;
    return request.user?.id;
  },
);

export const Principal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestPrincipal | undefined => {
    return ctx.switchToHttp().getRequest<AuthedRequest>().principal;
  },
);

export const OrganizationId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<AuthedRequest>();
    return request.organizationId ?? request.headers['x-organization-id'];
  },
);

/** Set by OrgRolesGuard after membership check (human JWT). */
export const MembershipRole = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrganizationMemberRole | undefined => {
    const request = ctx.switchToHttp().getRequest<AuthedRequest>();
    return request.membershipRole;
  },
);
