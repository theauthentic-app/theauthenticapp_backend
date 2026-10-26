import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrganizationMemberRole } from '@prisma/client';
import { ORG_ROLES_KEY } from '../decorators/auth.decorators';
import { AuthUser } from '../decorators/current-user.decorator';
import { PrismaService } from '../../database/prisma.service';
import type { RequestPrincipal } from '../types/request-principal';

@Injectable()
export class OrgRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<OrganizationMemberRole[]>(
      ORG_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles || roles.length === 0) return true;

    const request = context.switchToHttp().getRequest<{
      user?: AuthUser;
      principal?: RequestPrincipal;
      headers: Record<string, string | undefined>;
      organizationId?: string;
      membershipRole?: OrganizationMemberRole;
    }>();

    if (request.principal?.kind === 'apiKey') {
      const header = request.headers['x-organization-id'];
      if (header) {
        const organization = await this.prisma.organization.findFirst({
          where: { OR: [{ publicId: header }, { id: header }] },
        });
        if (!organization || organization.id !== request.principal.organizationId) {
          throw new ForbiddenException(
            'x-organization-id does not match this API key.',
          );
        }
      }
      request.organizationId = request.principal.organizationId;
      return true;
    }

    const user = request.user;
    const header = request.headers['x-organization-id'];
    if (!user || !header) {
      throw new ForbiddenException('Organization context is required.');
    }

    const organization = await this.prisma.organization.findFirst({
      where: { OR: [{ publicId: header }, { id: header }] },
    });
    if (!organization) {
      throw new ForbiddenException('Organization context is required.');
    }

    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: user.id,
        },
      },
    });
    if (!membership) {
      throw new ForbiddenException(
        'You are not a member of this organization.',
      );
    }
    if (!roles.includes(membership.role)) {
      throw new ForbiddenException('Insufficient organization role.');
    }
    request.organizationId = organization.id;
    request.membershipRole = membership.role;
    return true;
  }
}
