import { SetMetadata } from '@nestjs/common';
import type { ApiScope } from '../constants/api-scopes';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ORG_ROLES_KEY = 'orgRoles';
export const OrgRoles = (...roles: string[]) =>
  SetMetadata(ORG_ROLES_KEY, roles);

export const PLATFORM_ROLES_KEY = 'platformRoles';
export const PlatformRoles = (...roles: string[]) =>
  SetMetadata(PLATFORM_ROLES_KEY, roles);

export const API_SCOPES_KEY = 'apiScopes';
export const ApiScopes = (...scopes: ApiScope[]) =>
  SetMetadata(API_SCOPES_KEY, scopes);

export const HUMAN_ONLY_KEY = 'humanOnly';
export const HumanOnly = () => SetMetadata(HUMAN_ONLY_KEY, true);

export const IDEMPOTENT_KEY = 'idempotent';
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);
