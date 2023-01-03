import { CacheTouch, RemoteCache } from "@level-two/core";
import Memcached from "memcached";
import { promisify } from "util";

/**
 * Memcached extension settings
 */
export interface MemcachedRemoteCacheSettings {
  /**
   * String prefix to use in front of each cache key
   */
  cachePrefix?: string;

  /**
   * Configuration options for creating a new Memcached client
   */
  clientOptions?: Memcached.options;
}

/**
 * Memcached backed cache extension for LevelTwo
 */
export class MemcachedRemoteCache<WorkerIdentifierType = string>
  implements RemoteCache<WorkerIdentifierType>
{
  /**
   * Memcached extension settings
   */
  public readonly settings: MemcachedRemoteCacheSettings;

  /**
   * Prefix string to use for all cache keys
   */
  public readonly cachePrefix: string;

  /**
   * Memcached instance created on setup
   */
  private realMemcached?: Memcached;

  /**
   * Location settings for memcached instance
   */
  private location: Memcached.Location;

  constructor(
    location: Memcached.Location,
    settings?: MemcachedRemoteCacheSettings
  ) {
    this.location = location;
    this.settings = settings || {};
    this.cachePrefix = this.settings.cachePrefix
      ? `${this.settings.cachePrefix}:`
      : "";
  }

  /**
   * Shortcut to only access existing memcached instance
   */
  public get memcached(): Memcached {
    if (!this.realMemcached) {
      throw new Error("Memcached remote cache not setup");
    }

    return this.realMemcached;
  }

  /**
   * Open memcached connection on startup
   */
  public async setup(): Promise<void> {
    this.realMemcached = new Memcached(
      this.location,
      this.settings.clientOptions
    );
  }

  /**
   * Close memcached connection on shutdown
   */
  public async teardown(): Promise<void> {
    this.realMemcached?.end();
  }

  /**
   * Fetches list of cache keys in a single batch
   * @param worker Worker namespace
   * @param ids List of unique identifiers to fetch
   * @param earlyWrite Early write mechanism for unblocking as results come in
   */
  public async get(
    worker: WorkerIdentifierType,
    ids: (string | number)[],
    earlyWrite: (id: string | number, value: any) => Promise<void>
  ): Promise<void> {
    const encodedIds = this.encodeCacheKeyList(worker, ids);
    const data = await promisify(this.memcached.getMulti.bind(this.memcached))(
      encodedIds
    );

    encodedIds.forEach((id, index) => {
      const value = data[id];
      earlyWrite(
        ids[index],
        typeof value === "string" ? JSON.parse(value) : undefined
      );
    });
  }

  /**
   * Sets cache entries into memcached in a single batch
   * @param worker Worker namespace
   * @param entries List of cache entries to set
   */
  public async set(
    worker: WorkerIdentifierType,
    entries: { id: string | number; value: any; ttl: number }[]
  ): Promise<void> {
    const setCache = promisify(this.memcached.set.bind(this.memcached));
    for (const entry of entries) {
      await setCache(
        this.encodeCacheKey(worker, entry.id),
        JSON.stringify(entry.value),
        Math.floor(entry.ttl / 1000)
      );
    }
  }

  /**
   * Deletes list of cache keys from memcached in a single batch
   * @param worker Worker namespace
   * @param ids List of unique identifiers to delete
   */
  public async delete(
    worker: WorkerIdentifierType,
    ids: (string | number)[]
  ): Promise<void> {
    const delCache = promisify(this.memcached.del.bind(this.memcached));
    for (const id of ids) {
      await delCache(this.encodeCacheKey(worker, id));
    }
  }

  /**
   * Extends the expiration of entries passed
   * @param worker Worker namespace
   * @param entries List of entries to touch
   */
  public async touch(
    worker: WorkerIdentifierType,
    entries: Required<CacheTouch<string | number>>[]
  ): Promise<void> {
    const touchCache = promisify(this.memcached.touch.bind(this.memcached));
    for (const entry of entries) {
      await touchCache(
        this.encodeCacheKey(worker, entry.id),
        Math.floor(entry.ttl / 1000)
      );
    }
  }

  /**
   * Checks to see if keys exist in the memcached cache
   * @param worker Worker namespace
   * @param ids List of unique identifiers to check
   */
  public async exists(
    worker: WorkerIdentifierType,
    ids: any[]
  ): Promise<boolean[]> {
    const encodedIds = this.encodeCacheKeyList(worker, ids);
    const data = await promisify(this.memcached.getMulti.bind(this.memcached))(
      encodedIds
    );

    return ids.map((id) => typeof data[id] === "string");
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
