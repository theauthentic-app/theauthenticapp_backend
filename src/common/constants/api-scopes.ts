export const API_SCOPES = [
  'VERIFY',
  'PRODUCT_READ',
  'PRODUCT_WRITE',
  'ANALYTICS_READ',
  'WEBHOOKS',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export const WEBHOOK_EVENTS = [
  'verification.created',
  'risk.detected',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
