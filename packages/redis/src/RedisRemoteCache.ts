import { CacheTouch, RemoteCache } from "@level-two/core";
import { createClient } from "redis";
import { LevelTwoRedisSettings } from ".";

type RedisClientType = ReturnType<typeof createClient>;

/**
 * Redis backed cache extension for LevelTwo
 */
export class RedisRemoteCache<WorkerIdentifierType>
  implements RemoteCache<WorkerIdentifierType>
{
  /**
   * Redis extension settings
   */
  public readonly settings: LevelTwoRedisSettings<WorkerIdentifierType>;

  /**
   * Redis instance used for caching
   */
  public readonly redis: RedisClientType;

  /**
   * Prefix string to use for all cache keys
   */
  public readonly cachePrefix: string;

  constructor(
    redis: RedisClientType,
    settings?: LevelTwoRedisSettings<WorkerIdentifierType>
  ) {
    this.redis = redis;
    this.settings = settings || {};
    this.cachePrefix = settings?.cachePrefix ? `${settings.cachePrefix}:` : "";
  }

  /**
   * Opens redis connection on startup
   */
  public async setup(): Promise<void> {
    if (!this.redis.isOpen) {
      await this.redis.connect();
    }
  }

  /**
   * Quits redis connection on shutdown
   */
  public async teardown(): Promise<void> {
    if (this.redis.isOpen) {
      await this.redis.quit();
    }
  }

  /**
   * Fetches list of cache keys in a single batch
   * @param worker Worker namespace these ids are being requested from
   * @param ids List of unique identifiers to fetch
   * @param earlyWrite Early write mechanism for unblocking as results come in
   */
  public async get(
    worker: WorkerIdentifierType,
    ids: (string | number)[],
    earlyWrite: (id: string | number, value: any) => Promise<void>
  ): Promise<void> {
    const results = await this.redis.mGet(this.encodeCacheKeyList(worker, ids));
    results.forEach((row, index) => {
      earlyWrite(
        ids[index],
        row && typeof row === "string" ? JSON.parse(row) : undefined
      );
    });
  }

  /**
   * Sets cache entries into redis in a single batch
   * @param worker Worker namespace these ids are being set from
   * @param entries List of cache entries to set
   */
  public async set(
    worker: WorkerIdentifierType,
    entries: { id: string | number; value: any; ttl: number }[]
  ): Promise<void> {
    let multi = this.redis.multi();
    entries.forEach((entry) => {
      multi = multi.setEx(
        this.encodeCacheKey(worker, entry.id),
        Math.floor(entry.ttl / 1000),
        JSON.stringify(entry.value)
      );
    });
    await multi.exec();
  }

  /**
   * Deletes list of cache keys from redis in a single batch
   * @param worker Worker namespace these ids are being deleted from
   * @param ids List of unique identifiers to delete
   */
  public async delete(
    worker: WorkerIdentifierType,
    ids: (string | number)[]
  ): Promise<void> {
    let multi = this.redis.multi();
    ids.forEach((id) => {
      multi = multi.del(this.encodeCacheKey(worker, id));
    });
    await multi.exec();
  }

  /**
   * Touches a key, or extends the expiration of the key passed
   * @param worker Worker namespace these ids are being deleted from
   * @param entries List of entries to touch
   */
  public async touch(
    worker: WorkerIdentifierType,
    entries: Required<CacheTouch<string | number>>[]
  ): Promise<void> {
    let multi = this.redis.multi();
    entries.forEach(({ id, ttl }) => {
      multi = multi.expire(
        this.encodeCacheKey(worker, id),
        Math.floor(ttl / 1000)
      );
    });
    await multi.exec();
  }

  /**
   * Checks to see if keys exist in the redis cache
   * @param worker Worker namespace these ids are being deleted from
   * @param ids List of unique identifiers to check
   */
  public async exists(
    worker: WorkerIdentifierType,
    ids: any[]
  ): Promise<boolean[]> {
    let multi = this.redis.multi();
    ids.forEach((id) => {
      multi = multi.exists(this.encodeCacheKey(worker, id));
    });
    const results = await multi.exec();
    return results.map((value) => value === 1);
  }

  /**
   * Normalizes worker and unique identifier into a combined cache key
   * @param worker Worker namespace
   * @param id Unique identifier for the cache key
   */
  private encodeCacheKey(worker: WorkerIdentifierType, id: string | number) {
    return `${this.cachePrefix}${worker}:${id}`;
  }

  /**
   * Normalizes a list of unique identifiers into cache keys
   * @param worker Worker namespace
   * @param ids List of unique identifiers to convert into cache keys
   */
  private encodeCacheKeyList(
    worker: WorkerIdentifierType,
    ids: (string | number)[]
  ) {
    return ids.map(this.encodeCacheKey.bind(this, worker));
  }
}
