import type { LevelTwo } from ".";

/**
 * Worker cache specific settings
 */
export interface CacheSettings {
  /**
   * Amount of time, in milliseconds, until cache entry is stale. This
   * value will be passed to the remote cache instance when setting new
   * values into a worker. Defaults to one minute
   */
  ttl?: number;

  /**
   * Minimum number of requests that must be made before entry
   * can be added to the local cache. Defaults to none
   */
  minimumRequestsForCache?: number;

  /**
   * Number of milliseconds between now and the "minimumRequestsForCache" request in
   * order for the entry to be placed in the local cache. Defaults length of the ttl
   *
   * Ex:
   * - minimumRequestsForCache: 5
   * - minimumRequestsTimeThreshold: 1000
   *
   * A request must be made five times for the same unique identifier within
   * the last one second for the result value to be added to the local cache
   */
  minimumRequestsTimeThreshold?: number;

  /**
   * Maximum number of cache keys that can exist in the local cache. Defaults to none
   */
  maximumCacheKeys?: number;

  /**
   * Number of milliseconds stale local cache entries are allowed to be used while an
   * updated value is fetched. Defaults to none
   */
  staleCacheThreshold?: number;

  /**
   * Indicator if any exceptions raised by the remote cache should be ignored,
   * which would result in those ids being sent to the worker instead of returning
   * an error for each id. Defaults to false
   */
  ignoreCacheFetchErrors?: boolean;
}

/**
 * Worker fetch process for fetching uncached data
 * @param identifiers List of unique identifiers to cache
 * @param earlyWrite Mechanism for unblocking parallelized fetches
 */
export type WorkerFetchProcess<ResultType, IdentifierType> = (
  identifiers: IdentifierType[],
  earlyWrite: (
    id: IdentifierType,
    result: ResultType | Error | undefined
  ) => Promise<void>
) => Promise<
  | Map<IdentifierType, ResultType | Error | undefined>
  | Array<ResultType | Error | undefined>
  | void
>;

/**
 * Broadcasted message format for keeping processes in sync
 * @param IdentifierType Data type for the unique identifier
 * @param WorkerIdentifierType Data type for the worker name
 */
export interface DistributedAction<
  IdentifierType,
  WorkerIdentifierType = string
> {
  /**
   * Worker identifier this message is bound to
   */
  worker: WorkerIdentifierType;

  /**
   * List of unique identifiers to take action on
   */
  ids: IdentifierType[];

  /**
   * Action to be taken on each process
   */
  action: "delete" | "upsert" | "touch";

  /**
   * For touch action only, custom ttl
   */
  ttls?: number[];
}

/**
 * External message broker, used to send signals to other LevelTwo processes
 * when caching data has changed
 *
 * @param WorkerIdentifierType Data type for the worker name
 */
export interface MessageBroker<WorkerIdentifierType = string> {
  /**
   * Signal for when LevelTwo instance has been started
   * @param levelTwo LevelTwo instance being started
   */
  setup?: (levelTwo: LevelTwo<WorkerIdentifierType>) => Promise<void>;

  /**
   * Signal for when LevelTwo instance has been stopped
   * @param levelTwo LevelTwo instance being stopped
   */
  teardown?: (levelTwo: LevelTwo<WorkerIdentifierType>) => Promise<void>;

  /**
   * Method for publishing actions that should be distributed
   * to every LevelTwo process
   *
   * @param action Action to be taken on every LevelTwo process
   */
  publish: (
    action: DistributedAction<any, WorkerIdentifierType>
  ) => Promise<void>;

  /**
   * Method for listening for actions that should be taken
   * on every LevelTwo process
   *
   * @param listener Callback listener to be triggered for every action
   */
  subscribe: (
    listener: (action: DistributedAction<any, WorkerIdentifierType>) => void
  ) => Promise<void>;
}

/**
 * External remote caching interface, for an more "persisted" layer
 * of caching in front of the workers
 *
 * @param WorkerIdentifierType Data type for the worker name
 */
export interface RemoteCache<WorkerIdentifierType = string> {
  /**
   * Signal for when LevelTwo instance has been started
   * @param levelTwo LevelTwo instance being started
   */
  setup?: (levelTwo: LevelTwo<WorkerIdentifierType>) => Promise<void>;

  /**
   * Signal for when LevelTwo instance has been stopped
   * @param levelTwo LevelTwo instance being stopped
   */
  teardown?: (levelTwo: LevelTwo<WorkerIdentifierType>) => Promise<void>;

  /**
   * Fetching list of unique identifiers (namespaced by worker id)
   * from external cache. This will be called before the actual worker is called.
   * If a result is found, then the worker will not be called for that specific id.
   *
   * Note*: Workers follow the BurstValve paradigm, which means multiple independent
   * fetches could be waiting on this one call to complete. To follow that pattern, an
   * early write mechanism is provided to unblock parallel queues as soon as data comes in
   *
   * @param worker Worker identifier
   * @param ids Unique identifiers to fetch
   * @param earlyWrite Mechanism for broadcasting results as soon as they come in
   */
  get: (
    worker: WorkerIdentifierType,
    ids: any[],
    earlyWrite: (id: any, value: any | Error | undefined) => Promise<void>
  ) => Promise<
    Map<any, any | Error | undefined> | Array<any | Error | undefined> | void
  >;

  /**
   * Setting new entries into the external cache. This is only triggered when a user
   * declares a value has changed
   *
   * @param worker Worker identifier
   * @param entries List of entries to be cached
   */
  set: (
    worker: WorkerIdentifierType,
    entries: RemoteCacheEntry<any, any>[]
  ) => Promise<void>;

  /**
   * Deleting data from an external cache. This is only triggered when a user
   * declares a value has been removed
   *
   * @param worker Worker identifier
   * @param ids List of unique cache identifiers
   */
  delete: (worker: WorkerIdentifierType, ids: any[]) => Promise<void>;

  /**
   * Extending ttl on the ids provided. Should ignore any keys that don't exist
   *
   * @param worker Worker identifier
   * @param ids List of unique cache identifiers
   */
  touch: (
    worker: WorkerIdentifierType,
    ids: Required<CacheTouch<any>>[]
  ) => Promise<void>;

  /**
   * Checks to see if the ids provided exist in the remote cache
   *
   * @param worker Worker identifier
   * @param ids List of unique cache identifiers
   */
  exists: (worker: WorkerIdentifierType, ids: any[]) => Promise<boolean[]>;
}

/**
 * Interface for setting a cache entry
 */
export interface CacheEntry<ResultType, IdentifierType> {
  /**
   * Unique cache identifier to touch
   */
  id: IdentifierType;

  /**
   * Value to set
   */
  value: ResultType;

  /**
   * TTL to apply to the ID
   */
  ttl?: number;
}

/**
 * Setting into remote cache requires ttl for each entry
 */
export type RemoteCacheEntry<ResultType, IdentifierType> = Required<
  CacheEntry<ResultType, IdentifierType>
>;

/**
 * Interface for touching a cache entry
 */
export interface CacheTouch<IdentifierType> {
  /**
   * Unique cache identifier to touch
   */
  id: IdentifierType;

  /**
   * TTL to apply to the ID
   */
  ttl?: number;
}
