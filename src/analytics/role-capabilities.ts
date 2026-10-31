import { OrganizationMemberRole } from '@prisma/client';

export type DashboardSections = {
  protection: boolean;
  insights: boolean;
  operations: boolean;
  finance: boolean;
  team: boolean;
};

/** What each org role may see on GET /analytics/dashboard. */
export const ORG_DASHBOARD_SECTIONS: Record<
  OrganizationMemberRole,
  DashboardSections
> = {
  VIEWER: {
    protection: true,
    insights: false,
    operations: false,
    finance: false,
    team: false,
  },
  ANALYST: {
    protection: true,
    insights: true,
    operations: false,
    finance: false,
    team: false,
  },
  STAFF: {
    protection: true,
    insights: false,
    operations: true,
    finance: false,
    team: false,
  },
  MANAGER: {
    protection: true,
    insights: true,
    operations: true,
    finance: false,
    team: false,
  },
  ADMIN: {
    protection: true,
    insights: true,
    operations: true,
    finance: true,
    team: true,
  },
  OWNER: {
    protection: true,
    insights: true,
    operations: true,
    finance: true,
    team: true,
  },
};

export function sectionsForRole(
  role?: OrganizationMemberRole | null,
): DashboardSections {
  if (!role) {
    // API keys: full manufacturer analytics (no personal team PII beyond counts).
    return ORG_DASHBOARD_SECTIONS.ADMIN;
  }
  return ORG_DASHBOARD_SECTIONS[role] ?? ORG_DASHBOARD_SECTIONS.VIEWER;
}
