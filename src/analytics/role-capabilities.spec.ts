import { OrganizationMemberRole } from '@prisma/client';
import { ORG_DASHBOARD_SECTIONS, sectionsForRole } from './role-capabilities';

describe('org dashboard role capabilities', () => {
  it('gives viewers protection only', () => {
    expect(sectionsForRole(OrganizationMemberRole.VIEWER)).toEqual({
      protection: true,
      insights: false,
      operations: false,
      finance: false,
      team: false,
    });
  });

  it('gives analysts insights without finance', () => {
    const s = sectionsForRole(OrganizationMemberRole.ANALYST);
    expect(s.insights).toBe(true);
    expect(s.finance).toBe(false);
    expect(s.team).toBe(false);
  });

  it('gives owners full cockpit', () => {
    expect(sectionsForRole(OrganizationMemberRole.OWNER)).toEqual(
      ORG_DASHBOARD_SECTIONS.OWNER,
    );
    expect(sectionsForRole(OrganizationMemberRole.OWNER).finance).toBe(true);
  });

  it('treats API keys (no role) like admin analytics', () => {
    expect(sectionsForRole(null)).toEqual(ORG_DASHBOARD_SECTIONS.ADMIN);
    expect(sectionsForRole(undefined)).toEqual(ORG_DASHBOARD_SECTIONS.ADMIN);
  });
});
