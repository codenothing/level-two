import EventEmitter from "events";
import { BurstValve } from "burst-valve";
import { DEFAULT_CACHE_TTL } from "./constants";
import {
  CacheEntry,
  CacheSettings,
  CacheTouch,
  DistributedAction,
  MessageBroker,
  RemoteCache,
  RemoteCacheEntry,
  WorkerFetchProcess,
} from "./interfaces";
import type { LevelTwo } from "./LevelTwo";

// Run prune every minute by default
const PRUNE_LOOP_THRESHOLD = 1000 * 60;

// Internal cache entry interface
interface InternalCacheEntry<ResultType> {
  expiresAt: number;
  staleAt: number;
  value: ResultType;
}

// Shortcut for picking which setting to use (global, local, or default)
const mergeSetting = <SettingType>(
  workerValue: SettingType | undefined,
  cacheValue: SettingType | undefined,
  defaultValue: SettingType
): SettingType => {
  if (workerValue !== undefined) {
    return workerValue;
  } else if (cacheValue !== undefined) {
    return cacheValue;
  } else {
    return defaultValue;
  }
};

/**
 * Worker configuration
 */
export interface WorkerSettings<
  ResultType,
  IdentifierType,
  WorkerIdentifierType = string
> extends CacheSettings {
  /**
   * Name of the worker, for use in namespacing cache entries
   */
  name: WorkerIdentifierType;

  /**
   * Worker process for fetching uncached data
   */
  worker: WorkerFetchProcess<ResultType, IdentifierType>;
}

// Worker specific events
export interface Worker<ResultType, IdentifierType> {
  on(event: "error", listener: (error: Error) => void): this;
  on(
    event: "upsert",
    listener: (id: IdentifierType, value: ResultType, ttl: number) => void
  ): this;
  on(event: "delete", listener: (id: IdentifierType) => void): this;
  on(event: "touch", listener: (id: IdentifierType, ttl: number) => void): this;
  on(event: "evict", listener: (id: IdentifierType) => void): this;

  once(event: "error", listener: (error: Error) => void): this;
  once(
    event: "upsert",
    listener: (id: IdentifierType, value: ResultType, ttl: number) => void
  ): this;
  once(event: "delete", listener: (id: IdentifierType) => void): this;
  once(
    event: "touch",
    listener: (id: IdentifierType, ttl: number) => void
  ): this;
  once(event: "evict", listener: (id: IdentifierType) => void): this;

  off(event: "error", listener: (error: Error) => void): this;
  off(
    event: "upsert",
    listener: (id: IdentifierType, value: ResultType, ttl: number) => void
  ): this;
  off(event: "delete", listener: (id: IdentifierType) => void): this;
  off(
    event: "touch",
    listener: (id: IdentifierType, ttl: number) => void
  ): this;
  off(event: "evict", listener: (id: IdentifierType) => void): this;

  emit(eventName: "error", error: Error): boolean;
  emit(
    eventName: "upsert",
    id: IdentifierType,
    value: ResultType,
    ttl: number
  ): boolean;
  emit(eventName: "delete", id: IdentifierType): boolean;
  emit(eventName: "touch", id: IdentifierType, ttl: number): boolean;
  emit(eventName: "evict", id: IdentifierType): boolean;
}

/**
 * Cache worker for fetching data on a namespace
 */
export class Worker<ResultType, IdentifierType, WorkerIdentifierType = string>
  extends EventEmitter
  implements Iterable<[IdentifierType, ResultType]>
{
  /**
   * Name of the worker, for use in namespacing cache entries
   */
  public readonly name: WorkerIdentifierType;

  /**
   * ttl for each cache entry
   */
  public readonly ttl: number;

  /**
   * ttl for each local cache entry only
   */
  public readonly ttlLocal: number;

  /**
   * Defined minimum request threshold before entries are add to the local cache
   */
  public readonly minimumRequestsForCache: number;

  /**
   * Time range for how quickly the minimum number of requests have to be made
   */
  public readonly minimumRequestsTimeThreshold: number;

  /**
   * Maximum number of local cache keys allowed for this worker
   */
  public readonly maximumCacheKeys: number;

  /**
   * Number of milliseconds stale local cache entries are allowed to be used while an
   * updated value is fetched
   */
  public readonly staleCacheThreshold: number;

  /**
   * Indicates if it is ok to ignore any errors that occur while fetching from remote cache.
   * This *may* be useful in unique circumstances where the ephemeral cache is flaky, but this
   * will throw unbounded load at any external calls made in the worker process
   */
  public readonly ignoreCacheFetchErrors: boolean;

  /**
   * Worker process for fetching uncached data
   */
  private worker: WorkerFetchProcess<ResultType, IdentifierType>;

  /**
   * Reference to the parent levelTwo instance
   */
  private levelTwo: LevelTwo<WorkerIdentifierType>;

  /**
   * Private BurstValve for limiting concurrency per unique identifier
   */
  private burstValve: BurstValve<ResultType | undefined, IdentifierType>;

  /**
   * Internal local cache
   */
  private cache = new Map<IdentifierType, InternalCacheEntry<ResultType>>();

  /**
   * Internal local cache request counter
   */
  private cacheRequests = new Map<IdentifierType, number[]>();

  /**
   * Prune loop timer
   */
  private pruneTimerId?: NodeJS.Timer;

  constructor(
    levelTwo: LevelTwo<WorkerIdentifierType>,
    settings: WorkerSettings<ResultType, IdentifierType, WorkerIdentifierType>
  ) {
    super();
    this.levelTwo = levelTwo;
    this.name = settings.name;
    this.worker = settings.worker;
    this.ttl =
      settings.ttl || levelTwo.settings.cacheDefaults?.ttl || DEFAULT_CACHE_TTL;
    this.ttlLocal =
      settings.ttlLocal ||
      levelTwo.settings.cacheDefaults?.ttlLocal ||
      this.ttl;
    this.minimumRequestsForCache = mergeSetting(
      settings.minimumRequestsForCache,
      levelTwo.settings.cacheDefaults?.minimumRequestsForCache,
      0
    );
    this.minimumRequestsTimeThreshold = mergeSetting(
      settings.minimumRequestsTimeThreshold,
      levelTwo.settings.cacheDefaults?.minimumRequestsTimeThreshold,
      this.ttl
    );
    this.maximumCacheKeys = mergeSetting(
      settings.maximumCacheKeys,
      levelTwo.settings.cacheDefaults?.maximumCacheKeys,
      0
    );
    this.staleCacheThreshold = mergeSetting(
      settings.staleCacheThreshold,
      levelTwo.settings.cacheDefaults?.staleCacheThreshold,
      0
    );
    this.ignoreCacheFetchErrors = mergeSetting(
      settings.ignoreCacheFetchErrors,
      levelTwo.settings.cacheDefaults?.ignoreCacheFetchErrors,
      false
    );
    this.pruneTimerId = setInterval(
      this.prune.bind(this),
      Math.min(this.ttl, this.ttlLocal, PRUNE_LOOP_THRESHOLD)
    );
    this.burstValve = new BurstValve({
      displayName: `'${this.name}' Worker`,
      batch: this.batchFetcherProcess.bind(this),
    });

    this.levelTwo.on("action", this.incomingAction.bind(this));

    this.levelTwo.on("teardown", () => {
      if (this.pruneTimerId) {
        clearInterval(this.pruneTimerId);
        this.pruneTimerId = undefined;
      }
    });
  }

  /**
   * Shortcut method for batch fetching a single object. Any error is thrown
   * instead of returned
   *
   * @param id Unique identifier to get
   */
  public async get(id: IdentifierType): Promise<ResultType | undefined> {
    const result = await this.getMulti([id]);

    if (result[0] instanceof Error) {
      throw result[0];
    } else {
      return result[0];
    }
  }

  /**
   * Gets a a list of values for the identifiers provided. First attempts to find values
   * from the local cache, then falls back to remote cache if defined, and finally pulls
   * from the worker process.
   *
   * Identifiers not found in local cache are then run through a BurstValve to batch fetch
   * from remote cache or worker process. This means that there will only be one active
   * request per identifier for the given worker.
   *
   * @param ids List of unique identifiers to get
   */
  public async getMulti(
    ids: IdentifierType[]
  ): Promise<Array<ResultType | Error | undefined>> {
    // Test local cache to see if all results can be returned immediately
    const [needsFetch, cachedValues, staleIds] = this.getCachedEntries(ids);
    if (!needsFetch) {
      if (staleIds.length) {
        this.upsertStaleIds(staleIds);
      }

      return cachedValues;
    }

    // Run the actual batch fetching, returning any errors as result entries
    return this.runBatchFetch(ids, cachedValues, staleIds) as Promise<
      Array<ResultType | Error | undefined>
    >;
  }

  /**
   * Similar to getMulti, fetches list of values for the identifiers provided, but
   * raises exceptions when they are found instead of returning errors
   *
   * @param ids List of unique identifiers to get
   */
  public async getUnsafeMulti(
    ids: IdentifierType[]
  ): Promise<Array<ResultType | undefined>> {
    // Test local cache to see if all results can be returned immediately
    const [needsFetch, cachedValues, staleIds] = this.getCachedEntries(ids);
    if (!needsFetch) {
      if (staleIds.length) {
        this.upsertStaleIds(staleIds);
      }

      return cachedValues;
    }

    // Run the actual batch fetching, raising any exceptions
    return this.runBatchFetch(ids, cachedValues, staleIds, true) as Promise<
      Array<ResultType | undefined>
    >;
  }

  /**
   * Exposes data as it becomes available for the unique identifiers requested
   *
   * @param ids List of unique identifiers to get
   * @param streamResultCallback Iterative callback for each result as it is available
   */
  public async stream(
    ids: IdentifierType[],
    streamResultCallback: (
      id: IdentifierType,
      result: ResultType | Error | undefined
    ) => Promise<void>
  ): Promise<void> {
    const uniqueIds = [...new Set(ids)];
    const fetchSet = new Set<IdentifierType>();
    const streamPromises: Promise<void>[] = [];
    const [, quickResults, staleIds] = this.getCachedEntries(uniqueIds);

    // Auto signal cached results, collect uncached ids
    quickResults.forEach((value, index) => {
      const id = uniqueIds[index];

      if (value === undefined) {
        fetchSet.add(id);
      } else {
        streamPromises.push(streamResultCallback(id, value));
      }
    });

    // Trigger stream fetching through burst valve for any uncached items
    if (fetchSet.size) {
      streamPromises.push(
        this.burstValve.stream(Array.from(fetchSet), streamResultCallback)
      );
    }

    // Kick off any stale id fetching
    if (staleIds.length) {
      this.upsertStaleIds(staleIds);
    }

    // Wait for all stream result callbacks to complete
    await Promise.all(streamPromises);
  }

  /**
   * Shortcut method for upserting a single object. Any error is thrown
   * instead of returned
   *
   * @param id Unique identifier to fetch
   * @param skipRemoteCache Bypasses remote cache
   */
  public async upsert(
    id: IdentifierType,
    skipRemoteCache?: boolean
  ): Promise<ResultType | undefined> {
    const result = (await this.upsertMulti([id], skipRemoteCache))[0];

    if (result instanceof Error) {
      throw result;
    } else {
      return result;
    }
  }

  /**
   * Bypasses local cache and burst valve, fetching raw data directly from the
   * remote cache or fetcher process. When skipRemoteCache is enabled, results
   * are pulled directly from the fetcher process and set back into the remote
   * cache (successful fetches only)
   *
   * @param ids List of unique identifiers to fetch
   * @param skipRemoteCache Bypasses remote cache
   */
  public async upsertMulti(
    ids: IdentifierType[],
    skipRemoteCache?: boolean
  ): Promise<Array<ResultType | Error | undefined>> {
    const results = new Map<IdentifierType, ResultType | Error | undefined>();

    await this.batchFetcherProcess(
      ids,
      (id, result) => results.set(id, result),
      skipRemoteCache
    );

    return ids.map((id) => results.get(id));
  }

  /**
   * Shortcut method for setting a single entry.
   *
   * @param id Unique cache identifier
   * @param value Result object to cache
   * @param ttl Amount of time in milliseconds before value is stale
   */
  public async set(
    id: IdentifierType,
    value: ResultType,
    ttl?: number
  ): Promise<void> {
    await this.setMulti([{ id, value, ttl }]);
  }

  /**
   * Sets cache entries in both remote and local caches,
   * then signals to all other systems to update their locals
   *
   * @param entries Cache entries to set
   */
  public async setMulti(
    entries: CacheEntry<ResultType, IdentifierType>[]
  ): Promise<void> {
    const ids: IdentifierType[] = [];
    const ttls: number[] = [];
    const remoteValues: RemoteCacheEntry<ResultType, IdentifierType>[] = [];

    entries.forEach((entry) => {
      this.addToCache(entry.id, entry.value, entry.ttl);
      ids.push(entry.id);
      ttls.push(entry.ttl || this.ttl);
      remoteValues.push({
        id: entry.id,
        value: entry.value,
        ttl: entry.ttl || this.ttl,
      });
    });

    await this.remoteCache?.set(this.name, remoteValues);
    await this.publishAction(ids, "upsert", ttls);
  }

  /**
   * Shortcut method for deleting a single entry.
   *
   * @param ids Unique cache identifier
   */
  public async delete(id: IdentifierType): Promise<void> {
    await this.deleteMulti([id]);
  }

  /**
   * Deletes cache entries in both remote and local caches,
   * then signals to all other systems to delete cache entry
   * from their locals if it exists
   *
   * @param ids Unique cache identifiers
   */
  public async deleteMulti(ids: IdentifierType[]): Promise<void> {
    ids.forEach((id) => {
      this.cache.delete(id);
      this.cacheRequests.delete(id);
      this.emit("delete", id);
    });

    await Promise.all([
      this.remoteCache?.delete(this.name, ids) || Promise.resolve(undefined),
      this.publishAction(ids, "delete"),
    ]);
  }

  /**
   * Shortcut method for touching a single entry
   *
   * @param id Unique cache identifier
   * @param ttl Optional custom time in milliseconds to extend each id. Defaults to worker ttl
   */
  public async touch(id: IdentifierType, ttl?: number): Promise<void> {
    await this.touchMulti([{ id, ttl }]);
  }

  /**
   * Extending ttl on the ids provided, ignoring any ids that don't exist. Signal will be
   * sent to all workers, and remote cache will be touched in parallel
   *
   * @param entries List of entries to touch
   */
  public async touchMulti(
    entries: CacheTouch<IdentifierType>[]
  ): Promise<void> {
    const now = Date.now();
    const ids: IdentifierType[] = [];
    const ttls: number[] = [];
    const remoteEntries: Required<CacheTouch<IdentifierType>>[] = [];

    entries.forEach(({ id, ttl }) => {
      ids.push(id);
      ttls.push(ttl || this.ttl);

      const entry = this.cache.get(id);
      if (entry) {
        entry.expiresAt = now + (ttl || this.ttlLocal);
        entry.staleAt = entry.expiresAt + this.staleCacheThreshold;
      }

      remoteEntries.push({ id, ttl: ttl || this.ttl });
    });

    await Promise.all([
      this.remoteCache?.touch(this.name, remoteEntries) || Promise.resolve(),
      this.publishAction(ids, "touch", ttls),
    ]);

    remoteEntries.forEach(({ id, ttl }) => this.emit("touch", id, ttl));
  }

  /**
   * Shortcut method for checking existence of a single id
   *
   * @param id Unique cache identifier
   * @param skipLocalCache Indicates if local cache should be bypassed for existence check
   */
  public async exists(
    id: IdentifierType,
    skipLocalCache?: boolean
  ): Promise<boolean> {
    return (await this.existsMulti([id], skipLocalCache))[0];
  }

  /**
   * Identifies if the list of unique identifiers exist in either the
   * local cache or the remote cache
   *
   * @param ids List of unique cache identifiers
   * @param skipLocalCache Indicates if local cache should be bypassed for existence check
   */
  public async existsMulti(
    ids: IdentifierType[],
    skipLocalCache?: boolean
  ): Promise<boolean[]> {
    const remoteIds: IdentifierType[] = [];
    const results = new Map<IdentifierType, boolean>();

    // Test local cache first, as long as it shouldn't be bypassed
    if (skipLocalCache !== true) {
      ids.forEach((id) => {
        if (this.has(id)) {
          results.set(id, true);
        } else {
          remoteIds.push(id);
        }
      });
    } else {
      remoteIds.push(...ids);
    }

    // Only test remote cache for ids not in local
    if (this.remoteCache && remoteIds.length) {
      const remoteResults = await this.remoteCache.exists(this.name, remoteIds);
      if (remoteResults.length !== remoteIds.length) {
        throw new Error(
          `Unknown return length from remote cache for exists, results length must match ids length`
        );
      }

      remoteResults.forEach((value, index) =>
        results.set(remoteIds[index], value)
      );
    }

    return ids.map((id) => results.get(id) || false);
  }

  /**
   * Broadcasts action to workers connected through the message broker
   * @param action Signal to send to other workers
   * @param ids Unique cache identifiers to apply action to
   */
  public async broadcast(action: "upsert" | "delete", ids: IdentifierType[]) {
    if (!this.messageBroker) {
      throw new Error("Message broker not configured");
    }

    await this.publishAction(ids, action);
  }

  /**
   * Number of valid entries in the cache
   */
  public size(): number {
    return this.keys().length;
  }

  /**
   * Indicates if the identifier exists in the local cache only
   * @param id Unique cache identifier
   */
  public has(id: IdentifierType): boolean {
    const entry = this.cache.get(id);
    return entry && entry.staleAt > Date.now() ? true : false;
  }

  /**
   * Indicates if the identifiers exist in the local cache only
   * @param ids Unique cache identifiers
   */
  public hasMulti(ids: IdentifierType[]): boolean[] {
    return ids.map((id) => this.has(id));
  }

  /**
   * Returns list of valid keys in the cache
   */
  public keys(): IdentifierType[] {
    const ids: IdentifierType[] = [];
    for (const [id] of this) {
      ids.push(id);
    }
    return ids;
  }

  /**
   * Returns list of valid cache entry values in the cache
   */
  public values(): ResultType[] {
    const values: ResultType[] = [];
    for (const entry of this) {
      values.push(entry[1]);
    }
    return values;
  }

  /**
   * Returns list of valid cache entries in the cache
   */
  public entries(): Array<[IdentifierType, ResultType]> {
    const entries: Array<[IdentifierType, ResultType]> = [];
    for (const [id, value] of this) {
      entries.push([id, value]);
    }
    return entries;
  }

  /**
   * Executes the provided function once per each valid id/value pair in the cache
   * @param iter Iterator function called for each id/value paid
   */
  public forEach(iter: (value: ResultType, id: IdentifierType) => void): void {
    for (const [id, value] of this) {
      iter(value, id);
    }
  }

  /**
   * Inserts the provided list of entries into the local cache only, overriding
   * any existing entries
   *
   * @param entries List entries to store into the cache
   */
  public prefill(entries: CacheEntry<ResultType, IdentifierType>[]): void {
    entries.forEach((entry) =>
      this.addToCache(entry.id, entry.value, entry.ttl)
    );
  }

  /**
   * Returns local cache entries only for the unique identifier
   * provided, or undefined if the entry does not exist
   *
   * @param id Unique cache identifier
   */
  public peek(id: IdentifierType): ResultType | undefined {
    const entry = this.cache.get(id);
    return entry && entry.staleAt > Date.now() ? entry.value : undefined;
  }

  /**
   * Returns local cache entries only for the list of unique identifiers
   * provided, or undefined if the entry does not exist
   *
   * @param ids List of unique cache identifiers
   */
  public peekMulti(ids: IdentifierType[]): Array<ResultType | undefined> {
    return ids.map((id) => this.peek(id));
  }

  /**
   * Deletes any expired (past stale) entries from the local cache, as
   * well as any expired minimum request count trackers
   */
  public prune(): void {
    const now = Date.now();

    // Clean out stale cache requests
    this.cacheRequests.forEach((requests, id) => {
      const filtered = requests.filter(
        (time) => now - time < this.minimumRequestsTimeThreshold
      );

      if (!filtered.length) {
        this.cacheRequests.delete(id);
      } else if (filtered.length < requests.length) {
        this.cacheRequests.set(id, filtered);
      }
    });

    // Clean out stale cache entries
    this.cache.forEach((entry, id) => {
      if (entry.staleAt < now) {
        this.cache.delete(id);
        this.emit("evict", id);
      }
    });

    // Reduce number of keys to below max count
    if (this.maximumCacheKeys > 0 && this.cache.size > this.maximumCacheKeys) {
      Array.from(this.cache)
        .slice(0, this.cache.size - this.maximumCacheKeys)
        .forEach(([id]) => {
          this.cache.delete(id);
          this.emit("evict", id);
        });
    }
  }

  /**
   * Clears local caches of all entries
   */
  public clear(): void {
    this.cache.clear();
    this.cacheRequests.clear();
  }

  /**
   * Iterator to make the worker iterable on the valid cache entries
   */
  public *[Symbol.iterator](): IterableIterator<[IdentifierType, ResultType]> {
    for (const [id, entry] of this.cache) {
      if (entry.staleAt > Date.now()) {
        yield [id, entry.value];
      }
    }
  }

  /**
   * Shortcut to access remote cache integration
   */
  private get remoteCache(): RemoteCache<WorkerIdentifierType> | undefined {
    return this.levelTwo.remoteCache;
  }

  /**
   * Shortcut to access message broker integration
   */
  private get messageBroker(): MessageBroker<WorkerIdentifierType> | undefined {
    return this.levelTwo.messageBroker;
  }

  /**
   * Fetches and caches stale ids in the background
   * @param ids List of unique identifiers to fetch in parallel
   */
  private upsertStaleIds(ids: IdentifierType[]): void {
    this.burstValve.batch(ids).catch((e) => {
      this.emit(
        "error",
        new Error(
          `Error during stale cache background fetch for ids "${ids.join(
            ","
          )}"`,
          { cause: e }
        )
      );
    });
  }

  /**
   * Gets all locally cached valid entries for the provided list of ids
   *
   * Note*: This method has some micro optimizations for faster local
   * cache retrieval. As such, readability is a lower priority.
   *
   * All performance suggestions for this method and getMulti
   * are happily requested.
   *
   * @param ids Unique cache identifiers
   */
  private getCachedEntries(ids: IdentifierType[]): [
    // Indicates if a fetch request is required
    boolean,
    // List of cached results mapping to the id
    (ResultType | undefined)[],
    // List of stale IDs
    IdentifierType[]
  ] {
    const now = Date.now();
    const staleIds: IdentifierType[] = [];
    let needsFetch = false;

    // Find all valid local cache entries
    const quickResults: (ResultType | undefined)[] = ids.map((id) => {
      const entry = this.cache.get(id);

      // Cache entry exists, see if it can be used
      if (entry) {
        // staleAt is always >= expiresAt, so delete
        // the entry if it is beyond stale
        if (entry.staleAt < now) {
          this.cache.delete(id);
          this.emit("evict", id);
          needsFetch = true;

          // Reset cache request counts if that is in use
          if (this.minimumRequestsForCache > 0) {
            this.cacheRequests.set(id, [now]);
          }
        } else {
          // Add stale id to be fetched
          if (entry.expiresAt < now && !this.burstValve.isActive(id)) {
            staleIds.push(id);
          }

          return entry.value;
        }
      } else {
        needsFetch = true;

        // Cache miss, increment request count if configured
        if (this.minimumRequestsForCache > 0) {
          const requests = this.cacheRequests.get(id);
          if (requests) {
            requests.unshift(now);

            // Keep list of request timestamps trimmed
            if (requests.length > this.minimumRequestsForCache) {
              requests.pop();
            }
          } else {
            this.cacheRequests.set(id, [now]);
          }
        }
      }
    });

    return [needsFetch, quickResults, staleIds];
  }

  /**
   * Validates value can be saved to the local cache before setting.
   * Returns true if caching is allowed, false if denied
   *
   * @param id Unique cache identifier
   * @param value Value to be saved to the local cache
   * @param ttl Custom ttl being applied to the cache entry
   */
  private addToCache(
    id: IdentifierType,
    value: ResultType,
    ttl: number | undefined
  ): boolean {
    const now = Date.now();

    // Validate value can be cached
    if (this.minimumRequestsForCache > 0 && !this.cache.has(id)) {
      const requests = this.cacheRequests.get(id);

      // Skip cache setting if number of requests does not exceed the minimum
      if (!requests || requests.length < this.minimumRequestsForCache) {
        return false;
      } else {
        const last = requests[requests.length - 1];

        if (now - last > this.minimumRequestsTimeThreshold) {
          return false;
        }
      }
    }

    // Default to configured ttl
    ttl ||= this.ttlLocal;

    // Clear any request counts before setting
    this.cacheRequests.delete(id);
    this.cache.set(id, {
      value,
      expiresAt: now + ttl,
      staleAt: now + ttl + this.staleCacheThreshold,
    });

    // Resize local cache
    this.prune();

    // Signal change in cache value
    this.emit("upsert", id, value, ttl);

    return true;
  }

  /**
   * Handles incoming broadcasted actions from other instances
   * @param action Distributed action being taken
   */
  private incomingAction(
    action: DistributedAction<IdentifierType, WorkerIdentifierType>
  ): void {
    // Only handle events for this worker
    if (action.worker !== this.name) {
      return;
    }
    // Deleting a local cache entry
    else if (action.action === "delete") {
      action.ids.forEach((id) => {
        this.cache.delete(id);
        this.cacheRequests.delete(id);
        this.emit("delete", id);
      });
    } else if (action.action === "touch") {
      const now = Date.now();
      action.ids.forEach((id, index) => {
        const entry = this.cache.get(id);
        if (entry) {
          entry.expiresAt = now + (action.ttls?.[index] || this.ttlLocal);
          entry.staleAt = entry.expiresAt + this.staleCacheThreshold;
        }
      });
    }
    // Updating an existing cache entry
    else if (action.action === "upsert") {
      const cachedIds: IdentifierType[] = [];
      const ttls: (number | undefined)[] = [];

      // Only update locally if entry already exists in the cache
      action.ids.forEach((id, index) => {
        if (this.cache.has(id)) {
          cachedIds.push(id);
          ttls.push(action.ttls ? action.ttls[index] : undefined);
        }
      });
      if (!cachedIds.length) {
        return;
      }

      // Force load the existing ids
      const results = new Map<IdentifierType, ResultType | Error | undefined>();
      this.batchFetcherProcess(
        cachedIds,
        (id, value) => results.set(id, value),
        false,
        ttls
      ).then(() => {
        const missingIds: IdentifierType[] = [];

        results.forEach((value, id) => {
          if (value === undefined || value instanceof Error) {
            missingIds.push(id);
          }
        });

        // Raise exception for any missing ids
        if (missingIds.length) {
          this.emit(
            "error",
            new Error(
              `Failed to fetch value for upserted cache keys "${missingIds.join(
                ", "
              )}"`
            )
          );
        }
      });
    }
  }

  /**
   * Sends action signal to all systems
   * @param ids Unique cache identifiers
   * @param action Action to be taken on the entry
   */
  private async publishAction(
    ids: IdentifierType[],
    action: DistributedAction<IdentifierType>["action"],
    ttls?: number[]
  ): Promise<void> {
    await this.messageBroker?.publish({
      action,
      worker: this.name,
      ids: ids,
      ttls,
    });
  }

  /**
   * Normalized runner for fetching a batch of values from a list of unique
   * identifiers, merging in the pre-cached results
   *
   * @param ids List of unique identifiers to get
   * @param cachedValues List of cached results mapping to the id
   * @param staleIds List of cached identifiers that need to be re-fetched
   * @param raiseExceptions Indicates if exceptions should be thrown instead of returned
   */
  private async runBatchFetch(
    ids: IdentifierType[],
    cachedValues: (ResultType | undefined)[],
    staleIds: IdentifierType[],
    raiseExceptions?: true
  ): Promise<Array<ResultType | Error | undefined>> {
    // Only get uncached entries
    const fetchSet = new Set<IdentifierType>();
    const results = new Map<IdentifierType, ResultType | Error | undefined>();
    cachedValues.forEach((value, index) => {
      const id = ids[index];

      if (value === undefined) {
        fetchSet.add(id);
      } else {
        results.set(id, value);
      }
    });

    return new Promise((resolve, reject) => {
      const fetchIds = Array.from(fetchSet);
      const batchPromise = raiseExceptions
        ? this.burstValve.unsafeBatch(fetchIds)
        : this.burstValve.batch(fetchIds);

      batchPromise
        .then((batchResults) => {
          if (batchResults) {
            fetchIds.forEach((id, index) =>
              results.set(id, batchResults[index])
            );
          }

          resolve(ids.map((id) => results.get(id)));
        })
        .catch(reject);

      if (staleIds.length) {
        this.upsertStaleIds(staleIds);
      }
    });
  }

  /**
   * Valve fetcher process. Looks for data first in the remote cache, then
   * falls back to the worker fetch process
   *
   * @param ids List of unique identifiers to fetch data for
   * @param earlyWrite Early writing mechanism for unlock parallelism
   * @param skipRemoteCache Internal mechanism for bypassing remote cache
   */
  private async batchFetcherProcess(
    ids: IdentifierType[],
    earlyWrite: (
      id: IdentifierType,
      result: ResultType | Error | undefined
    ) => void,
    skipRemoteCache?: boolean,
    ttls?: (number | undefined)[]
  ): Promise<void> {
    let batchIds: IdentifierType[] = [];
    const remoteCacheSet: RemoteCacheEntry<ResultType, IdentifierType>[] = [];

    // Handle no remote cache defined
    if (!this.remoteCache || skipRemoteCache === true) {
      batchIds = ids.slice(0);
    }
    // Check the remote cache
    else if (ids.length > 0) {
      const remote = this.remoteCache;
      await new Promise<void>((resolve, reject) => {
        let finished = false;
        const remoteResults = new Map<
          IdentifierType,
          ResultType | Error | undefined
        >();

        const writeRemoteResult = (
          id: IdentifierType,
          value: ResultType | Error | undefined
        ) => {
          // Don't duplicate responses
          if (!remoteResults.has(id)) {
            remoteResults.set(id, value);

            // Cache entry not found, needs to be fetched from worker process
            if (value === undefined) {
              batchIds.push(id);
            }
            // When configured, ignore cache fetching errors
            else if (this.ignoreCacheFetchErrors && value instanceof Error) {
              batchIds.push(id);
            }
            // Cache entry found, store it locally
            else {
              if (!(value instanceof Error)) {
                const ttl = ttls ? ttls[ids.indexOf(id)] : undefined;
                this.addToCache(id, value, ttl);
              }

              earlyWrite(id, value);
            }
          }
        };

        remote
          .get(this.name, ids, async (id, value) => {
            if (finished) {
              throw new Error(`Cache fetching already completed`);
            }

            writeRemoteResult(id, value);
          })
          .then((response) => {
            finished = true;

            try {
              // Mapped results from cache fetching
              if (response instanceof Map) {
                response.forEach((value, id) => {
                  writeRemoteResult(id, value);
                });
              }
              // Array of results matching the cache ids passed in
              else if (Array.isArray(response)) {
                // Enforcing array matching
                if (response.length !== ids.length) {
                  const error = new Error(
                    `Remote cache fetch returned inconsistent result length with fetch ids requested`
                  );
                  ids.forEach((id) => writeRemoteResult(id, error));
                } else {
                  response.forEach((value, index) =>
                    writeRemoteResult(ids[index], value)
                  );
                }

                return resolve();
              }

              // Ensure all ids are at least written
              ids.forEach((id) => writeRemoteResult(id, undefined));
              resolve();
            } catch (e) {
              reject(e);
            }
          })
          .catch((e) => {
            finished = true;

            try {
              // Ignore exceptions when configured
              const error = new Error(`Remote cache.get error`, { cause: e });
              ids.forEach((id) =>
                writeRemoteResult(
                  id,
                  this.ignoreCacheFetchErrors ? undefined : error
                )
              );
              resolve();
            } catch (e) {
              reject(e);
            }
          });
      });
    }

    // Run batch fetching process for anything not found in cache
    if (batchIds.length > 0) {
      await new Promise<void>((resolve, reject) => {
        let finished = false;
        const results = new Map<
          IdentifierType,
          ResultType | Error | undefined
        >();

        const writeResult = (
          id: IdentifierType,
          value: ResultType | Error | undefined
        ) => {
          // Don't override existing results
          if (!results.has(id)) {
            const ttl = ttls ? ttls[ids.indexOf(id)] : undefined;
            const canSetRemotely =
              // Only cache successful results
              value !== undefined &&
              !(value instanceof Error) &&
              // Confirm cache id meets caching requirements
              this.addToCache(id, value, ttl);

            if (canSetRemotely) {
              remoteCacheSet.push({
                id,
                value,
                ttl: ttl || this.ttl,
              });
            }

            // Write back to burst valve to unblock parallel fetches
            results.set(id, value);
            earlyWrite(id, value);
          }
        };

        // Run the fetch worker
        this.worker(batchIds, async (id, value) => {
          // Ignore any writes once the actual fetch process has completed
          if (finished) {
            throw new Error(`Worker fetch process has already completed`);
          }

          writeResult(id, value);
        })
          .then((response) => {
            finished = true;

            try {
              // Map of results
              if (response instanceof Map) {
                response.forEach((value, id) => {
                  writeResult(id, value);
                });
              }
              // Array of results matching the batch ids passed in
              else if (Array.isArray(response)) {
                // Enforcing array matching
                if (response.length !== batchIds.length) {
                  const error = new Error(
                    `Worker fetch results length does not match batch id length`
                  );
                  batchIds.forEach((id) => writeResult(id, error));
                } else {
                  response.forEach((value, index) =>
                    writeResult(batchIds[index], value)
                  );
                }

                return resolve();
              }

              // Ensure all ids are accounted for
              batchIds.forEach((id) => writeResult(id, undefined));
              resolve();
            } catch (e) {
              reject(e);
            }
          })
          .catch((e) => {
            finished = true;

            try {
              // Write error to every batch id
              const error = new Error(`Worker fetch process error`, {
                cause: e,
              });
              batchIds.forEach((id) => writeResult(id, error));
              resolve();
            } catch (e) {
              reject(e);
            }
          });
      });
    }

    // Set results of fetch process into the cache
    if (remoteCacheSet.length > 0 && this.remoteCache) {
      // Ignore any cache setting errors, data is already cached locally
      try {
        await this.remoteCache.set(this.name, remoteCacheSet);
      } catch (e) {
        this.emit(
          "error",
          new Error(`Failed to set workers results with remoteCache`, {
            cause: e,
          })
        );
      }
    }
  }
}
