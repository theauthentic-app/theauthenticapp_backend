import { OrganizationStatus } from '@prisma/client';
import { AppError } from '../errors/app-error';

export function kycRequired(): boolean {
  return process.env.ORG_KYC_REQUIRED === 'true';
}

export function initialOrgStatus(): OrganizationStatus {
  return kycRequired()
    ? OrganizationStatus.PENDING
    : OrganizationStatus.ACTIVE;
}

export function assertOrgWritable(org: {
  status: OrganizationStatus | string;
}) {
  if (org.status === OrganizationStatus.SUSPENDED) {
    throw new AppError(
      'ORGANIZATION_SUSPENDED',
      'This organization is suspended.',
      403,
    );
  }
  if (org.status === OrganizationStatus.REJECTED) {
    throw new AppError(
      'ORGANIZATION_REJECTED',
      'This organization was not approved.',
      403,
    );
  }
  if (org.status === OrganizationStatus.PENDING) {
    throw new AppError(
      'KYC_PENDING',
      'This organization is awaiting AUTHENTIC approval before it can issue identities.',
      403,
    );
  }
}
