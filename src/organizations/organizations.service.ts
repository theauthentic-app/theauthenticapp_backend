import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrganizationMemberRole, OrganizationType } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { publicId } from '../common/utils/crypto.util';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { trialCreateInput } from '../billing/plans';
import { initialOrgStatus } from '../common/utils/org-status.util';
import {
  paginatedResult,
  paginationOf,
  type PaginationInput,
} from '../common/utils/pagination.util';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async create(
    userId: string,
    input: {
      name: string;
      type: OrganizationType;
      country?: string;
      city?: string;
      legalName?: string;
      registrationNumber?: string;
      website?: string;
    },
  ) {
    const slugBase = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40);
    const org = await this.prisma.organization.create({
      data: {
        publicId: publicId('org'),
        name: input.name,
        slug: `${slugBase}-${Date.now().toString().slice(-4)}`,
        type: input.type,
        country: input.country ?? 'NG',
        city: input.city,
        legalName: input.legalName,
        registrationNumber: input.registrationNumber,
        website: input.website,
        status: initialOrgStatus(),
        verifiedAt: initialOrgStatus() === 'ACTIVE' ? new Date() : undefined,
        members: {
          create: { userId, role: OrganizationMemberRole.OWNER },
        },
        subscription: { create: trialCreateInput() },
      },
    });
    await this.audit.record({
      action: 'ORGANIZATION_UPDATED',
      actorUserId: userId,
      organizationId: org.id,
      entity: 'Organization',
      entityId: org.id,
    });
    return this.toPublic(org);
  }

  async listForUser(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId },
      include: { organization: true },
    });
    return memberships.map((m) => ({
      ...this.toPublic(m.organization),
      role: m.role,
    }));
  }

  async getByPublicId(publicOrgId: string, userId: string) {
    const org = await this.requireOrg(publicOrgId);
    await this.requireMembership(org.id, userId);
    return this.toPublic(org);
  }

  async requireOrg(publicOrgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { publicId: publicOrgId },
    });
    if (!org)
      throw new AppError(
        'ORGANIZATION_NOT_FOUND',
        'Organization not found.',
        404,
      );
    return org;
  }

  async requireMembership(organizationId: string, userId: string) {
    const membership = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    if (!membership) {
      throw new AppError(
        'FORBIDDEN',
        'You are not a member of this organization.',
        403,
      );
    }
    return membership;
  }

  async addMember(
    organizationId: string,
    actorUserId: string,
    email: string,
    role: OrganizationMemberRole,
  ) {
    await this.requireMembership(organizationId, actorUserId);
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user)
      throw new AppError(
        'USER_NOT_FOUND',
        'No user with that email exists.',
        404,
      );
    const member = await this.prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      update: { role },
      create: { organizationId, userId: user.id, role },
    });
    await this.audit.record({
      action: 'USER_ROLE_CHANGED',
      actorUserId,
      organizationId,
      entity: 'OrganizationMember',
      entityId: member.id,
      metadata: { role },
    });
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    const web = this.config.get<string>('APP_WEB_URL') ?? 'http://localhost:3000';
    await this.notifications.sendEmail({
      userId: user.id,
      to: user.email,
      subject: `You were added to ${org?.name ?? 'an AUTHENTIC workspace'}`,
      template: 'member-added',
      context: {
        firstName: user.firstName,
        organizationName: org?.name ?? 'AUTHENTIC',
        role,
        dashboardUrl: web,
      },
    });
    return { userId: user.publicId, role: member.role };
  }

  async updateMemberRole(
    organizationId: string,
    actorUserId: string,
    memberPublicUserId: string,
    role: OrganizationMemberRole,
  ) {
    const actor = await this.requireMembership(organizationId, actorUserId);
    if (
      actor.role !== OrganizationMemberRole.OWNER &&
      actor.role !== OrganizationMemberRole.ADMIN
    ) {
      throw new AppError('FORBIDDEN', 'Insufficient organization role.', 403);
    }
    if (role === OrganizationMemberRole.OWNER && actor.role !== OrganizationMemberRole.OWNER) {
      throw new AppError(
        'FORBIDDEN',
        'Only an owner can assign the OWNER role.',
        403,
      );
    }
    const targetUser = await this.prisma.user.findUnique({
      where: { publicId: memberPublicUserId },
    });
    if (!targetUser) {
      throw new AppError('USER_NOT_FOUND', 'User not found.', 404);
    }
    const target = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: targetUser.id,
        },
      },
    });
    if (!target) {
      throw new AppError('USER_NOT_FOUND', 'Member not found.', 404);
    }
    if (target.role === OrganizationMemberRole.OWNER && role !== OrganizationMemberRole.OWNER) {
      const owners = await this.prisma.organizationMember.count({
        where: { organizationId, role: OrganizationMemberRole.OWNER },
      });
      if (owners <= 1) {
        throw new AppError(
          'LAST_OWNER',
          'Cannot demote the last owner.',
          400,
        );
      }
    }
    const member = await this.prisma.organizationMember.update({
      where: { id: target.id },
      data: { role },
    });
    await this.audit.record({
      action: 'USER_ROLE_CHANGED',
      actorUserId,
      organizationId,
      entity: 'OrganizationMember',
      entityId: member.id,
      metadata: { role, userId: targetUser.publicId },
    });
    return { userId: targetUser.publicId, role: member.role };
  }

  async removeMember(
    organizationId: string,
    actorUserId: string,
    memberPublicUserId: string,
  ) {
    const actor = await this.requireMembership(organizationId, actorUserId);
    if (
      actor.role !== OrganizationMemberRole.OWNER &&
      actor.role !== OrganizationMemberRole.ADMIN
    ) {
      throw new AppError('FORBIDDEN', 'Insufficient organization role.', 403);
    }
    const targetUser = await this.prisma.user.findUnique({
      where: { publicId: memberPublicUserId },
    });
    if (!targetUser) {
      throw new AppError('USER_NOT_FOUND', 'User not found.', 404);
    }
    const target = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: targetUser.id,
        },
      },
    });
    if (!target) {
      throw new AppError('USER_NOT_FOUND', 'Member not found.', 404);
    }
    if (target.role === OrganizationMemberRole.OWNER) {
      const owners = await this.prisma.organizationMember.count({
        where: { organizationId, role: OrganizationMemberRole.OWNER },
      });
      if (owners <= 1) {
        throw new AppError(
          'LAST_OWNER',
          'Cannot remove the last owner.',
          400,
        );
      }
    }
    if (
      actor.role === OrganizationMemberRole.ADMIN &&
      target.role === OrganizationMemberRole.OWNER
    ) {
      throw new AppError('FORBIDDEN', 'Admins cannot remove owners.', 403);
    }
    await this.prisma.organizationMember.delete({ where: { id: target.id } });
    await this.audit.record({
      action: 'USER_ROLE_CHANGED',
      actorUserId,
      organizationId,
      entity: 'OrganizationMember',
      entityId: target.id,
      metadata: { removed: true, userId: targetUser.publicId },
    });
    return { removed: true, userId: targetUser.publicId };
  }

  async leave(organizationId: string, userId: string) {
    const membership = await this.requireMembership(organizationId, userId);
    if (membership.role === OrganizationMemberRole.OWNER) {
      const owners = await this.prisma.organizationMember.count({
        where: { organizationId, role: OrganizationMemberRole.OWNER },
      });
      if (owners <= 1) {
        throw new AppError(
          'LAST_OWNER',
          'Transfer ownership before leaving.',
          400,
        );
      }
    }
    await this.prisma.organizationMember.delete({ where: { id: membership.id } });
    return { left: true };
  }

  async listMembers(organizationId: string, query?: PaginationInput) {
    const { page, limit, skip, take } = paginationOf(query);
    const where = { organizationId };
    const [members, total] = await this.prisma.$transaction([
      this.prisma.organizationMember.findMany({
        where,
        include: { user: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.organizationMember.count({ where }),
    ]);
    return paginatedResult(
      members.map((member) => ({
        userId: member.user.publicId,
        email: member.user.email,
        firstName: member.user.firstName,
        lastName: member.user.lastName,
        role: member.role,
        createdAt: member.createdAt,
      })),
      total,
      page,
      limit,
    );
  }

  toPublic(org: {
    publicId: string;
    name: string;
    slug: string;
    type: OrganizationType;
    status: string;
    country: string;
    city: string | null;
    legalName: string | null;
    registrationNumber: string | null;
    website: string | null;
    verifiedAt: Date | null;
  }) {
    return {
      id: org.publicId,
      name: org.name,
      slug: org.slug,
      type: org.type,
      status: org.status,
      country: org.country,
      city: org.city,
      legalName: org.legalName,
      registrationNumber: org.registrationNumber,
      website: org.website,
      verified: Boolean(org.verifiedAt),
    };
  }
}
