import { CachedEntry, CachedEntryProps } from "./CachedEntry";

/**
 * Internal wrapper for the full Entry object, for shortcut management utils
 */
export class InternalCacheEntry<IdentifierType, ResultType> {
  /**
   * Externally usable cache entry object
   */
  public readonly entry: CachedEntry<IdentifierType, ResultType>;

  /**
   * Value of the cached entry
   */
  public value: ResultType;

  /**
   * Amount of time, in milliseconds, until cache entry is stale
   */
  public ttl = 0;

  /**
   * Number of milliseconds, after local cache entries expire, data is allowed to be
   * used while an updated value is fetched in the background
   */
  public staleCacheThreshold = 0;

  /**
   * Timestamp in milliseconds of when the cache entry becomes stale (can still be used, just refreshed in the background)
   */
  public staleAt = 0;

  /**
   * Timestamp in milliseconds of when the cache entry expires (can no longer be used)
   */
  public expiresAt = 0;

  /**
   * Indicates if cache entry has been accessed while stale
   */
  public staleHit = false;

  public constructor(entry: CachedEntryProps<IdentifierType, ResultType>) {
    this.entry = new CachedEntry(entry);
    this.value = entry.value;
    this.ttl = entry.ttl || 0;
    this.staleCacheThreshold = entry.staleCacheThreshold || 0;
    this.staleAt = this.entry.staleAt;
    this.expiresAt = this.entry.expiresAt;
  }

  /**
   * Unique cache identifier
   */
  public get id(): IdentifierType {
    return this.entry.id;
  }

  /**
   * Timestamp of when the *local* cache entry was created
   */
  public get createdAt(): number {
    return this.entry.createdAt;
  }

  /**
   * Source of where the value was fetched from
   */
  public get source(): CachedEntryProps<IdentifierType, ResultType>["source"] {
    return this.entry.source;
  }

  /**
   * Indicates if the entry is stale (can still be used, just past the expiration)
   */
  public get isStale(): boolean {
    return this.entry.isStale;
  }

  /**
   * Indicates if the entry is still usable (past stale threshold)
   */
  public get isExpired(): boolean {
    return this.entry.isExpired;
  }

  /**
   * Updates the value and ttls while preserving initiation values
   *
   * @param value Value of the cached entry
   * @param ttl Amount of time, in milliseconds, until cache entry is stale
   * @param staleCacheThreshold Threshold stale values are allowed to be used
   */
  public upsert(
    value: ResultType,
    ttl: number,
    staleCacheThreshold: number
  ): void {
    this.touch(ttl, staleCacheThreshold);
    this.value = this.entry.value = value;
    this.entry.upsertedAt = Date.now();
  }

  /**
   * Extends lifetime of the cache entry
   * @param ttl Amount of time, in milliseconds, until cache entry is stale
   * @param staleCacheThreshold Threshold stale values are allowed to be used
   */
  public touch(ttl: number, staleCacheThreshold: number): void {
    const now = Date.now();

    this.ttl = ttl;
    this.staleCacheThreshold = staleCacheThreshold;
    this.staleAt = this.entry.staleAt = now + this.ttl;
    this.expiresAt = this.entry.expiresAt =
      this.staleAt + this.staleCacheThreshold;
  }
}
