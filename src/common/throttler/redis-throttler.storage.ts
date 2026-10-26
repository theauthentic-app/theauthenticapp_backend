import { Injectable } from '@nestjs/common';
import type {
  ThrottlerStorage,
} from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const ttlSeconds = Math.max(1, Math.ceil(ttl / 1000));
    const totalHits = await this.redis.incr(`throttle:${key}`, ttlSeconds);
    const blocked = totalHits > limit;
    return {
      totalHits,
      timeToExpire: ttlSeconds,
      isBlocked: blocked,
      timeToBlockExpire: blocked
        ? Math.max(1, Math.ceil(blockDuration / 1000))
        : 0,
    };
  }
}
