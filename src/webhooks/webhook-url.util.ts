import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from '../common/errors/app-error';

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'metadata.google.internal',
]);

export function isPrivateIp(ip: string): boolean {
  if (ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) {
    return true;
  }
  if (ip.startsWith('169.254.') || ip === '::1') return true;
  const match = /^172\.(\d+)\./.exec(ip);
  if (match) {
    const octet = Number(match[1]);
    return octet >= 16 && octet <= 31;
  }
  return false;
}

export async function assertPublicWebhookUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError('INVALID_WEBHOOK_URL', 'Webhook URL is invalid.', 400);
  }

  const production = process.env.NODE_ENV === 'production';
  if (url.protocol !== 'https:' && (production || url.protocol !== 'http:')) {
    throw new AppError(
      'INVALID_WEBHOOK_URL',
      'Webhook URL must use https.',
      400,
    );
  }

  const host = url.hostname.toLowerCase();
  const allowLocal = process.env.NODE_ENV !== 'production';
  if (BLOCKED_HOSTS.has(host) && !allowLocal) {
    throw new AppError(
      'INVALID_WEBHOOK_URL',
      'Webhook URL must not target a private host.',
      400,
    );
  }
  if (host.endsWith('.local') || host.endsWith('.internal')) {
    throw new AppError(
      'INVALID_WEBHOOK_URL',
      'Webhook URL must not target a private host.',
      400,
    );
  }

  if (isIP(host) && isPrivateIp(host) && !allowLocal) {
    throw new AppError(
      'INVALID_WEBHOOK_URL',
      'Webhook URL must not target a private IP.',
      400,
    );
  }

  if (!isIP(host) && !allowLocal) {
    try {
      const resolved = await lookup(host, { all: true });
      if (resolved.some((row) => isPrivateIp(row.address))) {
        throw new AppError(
          'INVALID_WEBHOOK_URL',
          'Webhook URL must not resolve to a private IP.',
          400,
        );
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        'INVALID_WEBHOOK_URL',
        'Webhook host could not be resolved.',
        400,
      );
    }
  }

  return url;
}
