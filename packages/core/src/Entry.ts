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
   * Timestamp in milliseconds of when the cache entry expires (can still be used as stale if configured)
   */
  public expiresAt = 0;

  /**
   * Timestamp in milliseconds of when the cache entry can no longer be used (passed max stale threshold)
   */
  public staleAt = 0;

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
    this.expiresAt = now + (entry.ttl || 0);
    this.staleAt = this.expiresAt + (entry.staleCacheThreshold || 0);
    this.upsertedAt = now;
  }

  /**
   * Indicates if the entry is stale (can still be used, just past the expiration)
   */
  public get isStale(): boolean {
    return Date.now() > this.expiresAt;
  }

  /**
   * Indicates if the entry is still usable (past stale threshold)
   */
  public get isExpired(): boolean {
    return Date.now() > this.staleAt;
  }
}
