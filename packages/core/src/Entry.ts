/**
 * Options for creating an Entry instance
 */
export interface EntryProps<IdentifierType, ResultType> {
  /**
   * Unique cache identifier
   */
  id: IdentifierType;

  /**
   * Source of where the value was fetched from
   */
  source: "local-cache" | "remote-cache" | "worker-fetch";

  /**
   * Value of the cached entry
   */
  value?: ResultType;

  /**
   * Exception that occurred during fetching of value
   */
  error?: Error;

  /**
   * Amount of time, in milliseconds, until cache entry is stale
   */
  ttl?: number;

  /**
   * Number of milliseconds, after local cache entries expire, data is allowed to be
   * used while an updated value is fetched in the background
   */
  staleCacheThreshold?: number;

  /**
   * Timestamp of when the *local* cache entry was created
   */
  createdAt?: number;
}

/**
 * Full cache entry object
 */
export class Entry<IdentifierType, ResultType> {
  /**
   * Unique cache identifier
   */
  public readonly id: IdentifierType;

  /**
   * Timestamp of when the *local* cache entry was created
   */
  public readonly createdAt: number;

  /**
   * Source of where the value was fetched from
   */
  public readonly source: EntryProps<IdentifierType, ResultType>["source"];

  /**
   * Value of the cached entry
   */
  public value?: ResultType;

  /**
   * Exception that occurred during fetching of value
   */
  public error?: Error;

  /**
   * Timestamp in milliseconds of when the cache entry becomes stale (can still be used, just refreshed in the background)
   */
  public staleAt = 0;

  /**
   * Timestamp in milliseconds of when the cache entry expires (can no longer be used)
   */
  public expiresAt = 0;

  /**
   * Timestamp in millisecond of when the cache
   */
  public upsertedAt = 0;

  constructor(entry: EntryProps<IdentifierType, ResultType>) {
    const now = Date.now();

    this.id = entry.id;
    this.createdAt = entry.createdAt || Date.now();
    this.source = entry.source;
    this.value = entry.value;
    this.error = entry.error;
    this.staleAt = now + (entry.ttl || 0);
    this.expiresAt = this.staleAt + (entry.staleCacheThreshold || 0);
    this.upsertedAt = now;
  }

  /**
   * Indicates if the entry is stale (can still be used, just past the ttl)
   */
  public get isStale(): boolean {
    const now = Date.now();
    return now > this.staleAt && now <= this.expiresAt;
  }

  /**
   * Indicates if the entry is still usable (past stale threshold)
   */
  public get isExpired(): boolean {
    return Date.now() > this.expiresAt;
  }
}
