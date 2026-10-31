import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

type MemoryEntry = { value: string; expiresAt: number | null };

/**
 * Redis with in-process fallback. Production can run without Redis
 * (rate limits / cache are best-effort per instance). Login must not 500
 * when REDIS_URL points at localhost or a dead host.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null;
  private available = false;
  private readonly memory = new Map<string, MemoryEntry>();
  private warnedOffline = false;

  constructor(private readonly config: ConfigService) {
    const url = (this.config.get<string>('REDIS_URL') ?? '').trim();
    const nodeEnv = (this.config.get<string>('NODE_ENV') ?? '').trim();
    const looksLocal =
      /^redis:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url) ||
      /^rediss:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url);

    // On Render/production, localhost Redis can never work — skip connecting.
    if (!url || (nodeEnv === 'production' && looksLocal)) {
      if (url && looksLocal) {
        this.logger.warn(
          'REDIS_URL points at localhost in production; using in-memory fallback. Set an Upstash/Redis Cloud URL or clear REDIS_URL.',
        );
      }
      this.client = null;
      return;
    }

    this.client = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      connectTimeout: 3_000,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 200, 1_000);
      },
    });
    this.client.on('error', (err) => {
      this.available = false;
      if (!this.warnedOffline) {
        this.warnedOffline = true;
        this.logger.warn(
          `Redis unavailable (${err.message}); using in-memory fallback until it recovers.`,
        );
      }
    });
    this.client.on('connect', () => {
      this.available = true;
      this.warnedOffline = false;
      this.logger.log('Redis connected');
    });
    this.client.on('ready', () => {
      this.available = true;
    });
    this.client.on('end', () => {
      this.available = false;
    });
  }

  async connect(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.connect();
      await this.client.ping();
      this.available = true;
    } catch (error) {
      this.available = false;
      this.logger.warn(
        `Redis connect failed (${String(error)}); continuing with in-memory fallback.`,
      );
      try {
        this.client.disconnect();
      } catch {
        // ignore
      }
    }
  }

  onModuleDestroy(): void {
    if (this.client) {
      try {
        this.client.disconnect();
      } catch {
        // ignore
      }
    }
  }

  async ping(): Promise<boolean> {
    if (!this.client || !this.available) return false;
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      this.available = false;
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.client && this.available) {
      try {
        return await this.client.get(key);
      } catch {
        this.available = false;
      }
    }
    return this.memoryGet(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.client && this.available) {
      try {
        await this.client.set(key, value, 'EX', ttlSeconds);
        return;
      } catch {
        this.available = false;
      }
    }
    this.memorySet(key, value, ttlSeconds);
  }

  async setIfAbsent(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    if (this.client && this.available) {
      try {
        const result = await this.client.set(
          key,
          value,
          'EX',
          ttlSeconds,
          'NX',
        );
        return result === 'OK';
      } catch {
        this.available = false;
      }
    }
    if (this.memoryGet(key) != null) return false;
    this.memorySet(key, value, ttlSeconds);
    return true;
  }

  async del(key: string): Promise<void> {
    if (this.client && this.available) {
      try {
        await this.client.del(key);
      } catch {
        this.available = false;
      }
    }
    this.memory.delete(key);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    if (this.client && this.available) {
      try {
        const count = await this.client.incr(key);
        if (count === 1) {
          await this.client.expire(key, ttlSeconds);
        }
        return count;
      } catch {
        this.available = false;
      }
    }
    const current = Number(this.memoryGet(key) ?? '0');
    const next = current + 1;
    this.memorySet(key, String(next), ttlSeconds);
    return next;
  }

  private memoryGet(key: string): string | null {
    const entry = this.memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt != null && entry.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return entry.value;
  }

  private memorySet(key: string, value: string, ttlSeconds: number): void {
    this.memory.set(key, {
      value,
      expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
    });
  }
}
