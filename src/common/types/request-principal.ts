import type { AuthUser } from '../decorators/current-user.decorator';

export type UserPrincipal = {
  kind: 'user';
  user: AuthUser;
};

export type ApiKeyPrincipal = {
  kind: 'apiKey';
  apiKeyId: string;
  organizationId: string;
  scopes: string[];
};

export type RequestPrincipal = UserPrincipal | ApiKeyPrincipal;

export function actorUserIdFrom(
  principal?: RequestPrincipal,
): string | undefined {
  return principal?.kind === 'user' ? principal.user.id : undefined;
}

export function actorLabel(principal?: RequestPrincipal): string {
  if (!principal) return 'anonymous';
  if (principal.kind === 'user') return principal.user.id;
  return `API_KEY:${principal.apiKeyId}`;
}
