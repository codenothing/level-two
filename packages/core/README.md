# LevelTwo

An in-process cache for asynchronous data fetching to enable instantaneous results.

Configuring an external message broker (Redis, Kafka, RabbitMQ, etc.) will enable a distributed cache by signaling when entries should be updated or deleted. This keeps data in sync across multiple instances of the application by always having the most up to date value.

Configuring an external cache (Redis, Memcached, etc.) will enable a "longer term" cache that can persist application restarts and reduce database load in volatile environments.

Review the list of supported extensions below for easy configuration of common brokers and caches.

| Tool                                                                       | Description                                    |
| -------------------------------------------------------------------------- | ---------------------------------------------- |
| [@level-two/redis](https://www.npmjs.com/package/@level-two/redis)         | Redis extension for a message broker and cache |
| [@level-two/rabbitmq](https://www.npmjs.com/package/@level-two/rabbitmq)   | RabbitMQ extension for a message broker only   |
| [@level-two/kafka](https://www.npmjs.com/package/@level-two/kafka)         | Kafka extension for a message broker only      |
| [@level-two/memcached](https://www.npmjs.com/package/@level-two/memcached) | Memcached extension for a cache only           |

## Breaking Changes

Starting with version `2.0.0`: Iterable, `peek`, `peekMulti`, `values`, `entries`, `forEach` all return `CachedEntry` wrapped result values instead of the `ResultValue` directly.

Switching to a wrapped `CachedEntry` will allow for current and future expansion on utilities for metric tracking of entries.

## Usage

```ts
// Configure a one minute ttl for all workers by default
const levelTwo = new LevelTwo({
  cacheDefaults: {
    ttl: 60 * 1000,
  },
});

// Create a worker for getting cacheable customer objects
const worker = levelTwo.createWorker("customer", async (ids, earlyWrite) => {
  const rows = await mysql.query(
    "SELECT id, name FROM customers WHERE id IN (?)",
    [ids]
  );

  rows.forEach((row) => earlyWrite(row.id, row));
});

// Service method for getting a single customer
export async function getCustomer(id: string): Promise<Customer> {
  return await worker.get(id);
}

// Service method for getting a list of customers
export async function getCustomerList(ids: string[]): Promise<Customer[]> {
  return await worker.getMulti(ids);
}
```

Only the first request for a specific customer will reach out to the database, every subsequent request for that same identifier will pull from the worker cache (in process memory) and return immediately for the duration of the TTL set.

Even for simple data fetching like getting customer objects above, through the use of the local cache, applications will be able to handle significantly larger request loads. The following benchmark was run on a 2022 MacBook Air M2.

|                       | 5 entries                | 25 entries               | 50 entries               | 100 entries              |
| --------------------- | ------------------------ | ------------------------ | ------------------------ | ------------------------ |
| MySQL Direct Fetching | 11,131 ops/sec ±1.79%    | 8,855 ops/sec ±0.29%     | 6,984 ops/sec ±0.86%     | 5,439 ops/sec ±0.83%     |
| Redis Cache Fetching  | 34,219 ops/sec ±1.61%    | 22,107 ops/sec ±1.29%    | 15,336 ops/sec ±0.10%    | 10,704 ops/sec ±0.94%    |
| Using LevelTwo        | 6,945,483 ops/sec ±1.88% | 3,558,506 ops/sec ±0.12% | 2,351,602 ops/sec ±0.11% | 1,403,223 ops/sec ±0.91% |

## How It Works

The core of LevelTwo is built around batch fetching of data. Leveraging [BurstValve](https://www.npmjs.com/package/burst-valve) to reduce concurrency down to a single active request for a given identifier per application.

```ts
// Initially fetch github & npm to have those customer objects saved to local cache
const [github, npm] = await worker.getMulti(["github", "npm"]);

/**
 * Concurrent requests will only allow the identifier to be sent once to the underlying data fetcher
 *
 * Request 1: Github already cached, CircleCI, Jira, & Figma requested
 * Request 2: NPM already cached, CircleCI & Figma already active, only Slack is requested
 */
const [req1, req2] = await Promise.all([
  worker.getMulti(["github", "circleci", "jira", "figma"]),
  worker.getMulti(["circleci", "figma", "npm", "slack"]),
]);

req1; // [github, circleci, jira, figma]
req2; // [circleci, figma, npm, slack]
```

![batching](https://user-images.githubusercontent.com/204407/208055242-1f5f54f5-88b6-44fa-a287-a43d7f471234.jpg)

1. Github & NPM are already saved to the worker cache (in-process)
2. Req1: A data fetch is triggered CircleCI, Jira, & Figma
3. Req2: CircleCI & Figma are already active, a listener is added to await their results
4. Req2: A single data fetch it triggered for Slack
5. Results are collected and returned in the order the unique identifiers were passed for each request

## Worker Fetch Process

The fetch process is how a developer implements the database (or external service) fetching of cacheable data.

```ts
type WorkerFetchProcess = (
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
```

There are three formats for returning data to the worker to be cached:

1. **_Recommended_**: Use the [earlyWrite](https://github.com/codenothing/burst-valve#early-writing) mechanism to send results as they become available
2. Return a [Map](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map) object with the results mapped to their ids
3. Return an array of results that lineup exactly with the corresponding identifiers passed in, returning `undefined` where data could not be found

Returning `undefined` or an `Error` instance in replace of a result object will signal to the worker that nothing should be cached

## Single Key Workers

Dynamic application wide data sets can be fetched by assigning a worker to a single key.

```ts
// Create a worker for getting list of app wide feature flags
const worker = levelTwo.createSingleKeyWorker("feature-flags", async () => {
  return await mysql.query(`SELECT key, value FROM feature_flags`);
});

// Service method for getting a feature flags
export async function getFeatureFlags(): Promise<FeatureFlags> {
  return await worker.get();
}
```

## Cache Options

### `ttl`

Amount of time, in milliseconds, until cache entry is stale. This value will be passed to the remote cache instance when setting new values into a worker. Defaults to one minute.

### `ttlLocal`

Amount of time, in milliseconds, until local cache entry is stale. This value applies only to local cache entries, and does not get passed to remote cache instances. Defaults to the value of ttl.

### `minimumRequestsForCache`

Minimum number of requests that must be made before entry can be added to the local cache. Defaults to none.

### `minimumRequestsTimeThreshold`

Number of milliseconds between now and the "minimumRequestsForCache" request in order for the entry to be placed in the local cache. Defaults to length of the ttl.

For example:

- `minimumRequestsForCache`: 5
- `minimumRequestsTimeThreshold`: 1000

A request must be made five times for the same unique identifier within the last one second for the result value to be added to the local cache.

### `maximumCacheKeys`

Maximum number of cache keys that can exist in the local cache. Defaults to none.

### `staleCacheThreshold`

Number of milliseconds stale local cache entries are allowed to be used while an updated value is fetched. Defaults to none.

### `ignoreCacheFetchErrors`

Indicator if any exceptions raised by the remote cache should be ignored, which would result in those ids being sent to the worker instead of returning an error for each id. Defaults to false.

### `skipRemoteCache`

Skips usage of remote cache for this worker

## Worker API

Namespaced workers are used to fetch and cache data for a specific object type. The worker instance itself is an Iterable that can be looped over to investigate all valid cache entries.

### `get(id: IdentifierType)`

Shortcut method for batch fetching a single object. Any error is thrown instead of returned

### `getRequired(id: IdentifierType)`

Shortcut method for batch fetching a single required object. Any error is thrown instead of returned, and exception is raised if no value is found

### `getEntry(id: IdentifierType)`

Shortcut method for batch fetching a single Entry wrapped value. Exceptions are returned, not raised.

### `getMulti(ids: IdentifierType[])`

Gets a a list of values for the identifiers provided. First attempts to find values from the local cache, then falls back to remote cache if defined, and finally pulls from the worker process.

Identifiers not found in local cache are then run through a BurstValve to batch fetch from remote cache or worker process. This means that there will only be one active request per identifier for the given worker.

### `getUnsafeMulti(ids: IdentifierType[])`

Similar to getMulti, fetches list of values for the identifiers provided, but raises exceptions when they are found instead of returning errors

### `getRequiredMulti(ids: IdentifierType[])`

Similar to getMulti, fetches list of values for the identifiers provided, but raises exceptions when values are not found for any id

### `getEntryMulti(ids: IdentifierType[])`

Similar to getMulti, gets a a list of Entry wrapped values for the identifiers provided. The "source" indicates at what point the value was retrieved from (local-cache, remote-cache, or worker)

Exceptions are returned, not raised, and use the "error" source key

### `stream(ids: IdentifierType[], streamResultCallback: (id: IdentifierType, result: ResultType) => Promise<void>)`

Exposes data as it becomes available for the unique identifiers requested

### `upsert(id: IdentifierType, skipRemoteCache?: boolean)`

Shortcut method for upserting a single object. Any error is thrown instead of returned.

### `upsertRequired(id: IdentifierType, skipRemoteCache?: boolean)`

Shortcut method for upserting a single required object. Any error is thrown instead of returned, and exception raised for any value not found

### `upsertMulti(ids: IdentifierType[], skipRemoteCache?: boolean)`

Bypasses local cache and burst valve, fetching raw data directly from the remote cache or fetcher process. When skipRemoteCache is enabled, results are pulled directly from the fetcher process and set back into the remote cache (successful fetches only).

### `upsertRequiredMulti(ids: IdentifierType[], skipRemoteCache?: boolean)`

Similar to upsertMulti, with the addition that an error is thrown if no data could be found remotely

### `set(id: IdentifierType, value: ResultType, ttl?: number)`

Shortcut method for setting a single entry.

### `setMulti(entries: CacheEntry[])`

Sets cache entries in both remote and local caches, then signals to all other systems to update their locals.

### `delete(id: IdentifierType)`

Shortcut method for deleting a single entry.

### `deleteMulti(ids: IdentifierType[])`

Deletes cache entries in both remote and local caches, then signals to all other systems to delete cache entry from their locals if it exists.

### `touch(id: IdentifierType, ttl?: number)`

Shortcut method for touching a single entry.

### `touchMulti(entries: CacheTouch[])`

Extending ttl on the ids provided, ignoring any ids that don't exist. Signal will be sent to all workers, and remote cache will be touched in parallel.

### `exists(id: IdentifierType, skipLocalCache?: boolean)`

Shortcut method for checking existence of a single id.

### `existsMulti(ids: IdentifierType[], skipLocalCache?: boolean)`

Identifies if the list of unique identifiers exist in either the local cache or the remote cache.

### `broadcast(action: "upsert" | "delete", ids: IdentifierType[])`

Broadcasts action to workers connected through the message broker

### `size()`

Number of valid entries in the cache.

### `has(id: IdentifierType)`

Indicates if the identifier exists in the local cache only.

### `hasMulti(id: IdentifierType[])`

Indicates if the identifiers exist in the local cache only.

### `keys()`

Returns list of valid keys in the cache

### `values()`

Returns list of valid cache entry values in the cache.

### `entries()`

Returns list of valid cache entries in the cache.

### `forEach(iter: (value: CachedEntry<IdentifierType, ResultType>, id: IdentifierType) => void)`

Executes the provided function once per each valid id/value pair in the cache.

### `prefill(entries: CacheEntry[])`

Inserts the provided list of entries into the local cache only, overriding any existing entries.

### `peek(id: IdentifierType)`

Returns local cache entries only for the unique identifier provided, or undefined if the entry does not exist.

### `peekMulti(ids: IdentifierType[])`

Returns local cache entries only for the list of unique identifiers provided, or undefined if the entry does not exist.

### `prune()`

Deletes any expired (past stale) entries from the local cache, as well as any expired minimum request count trackers.

### `clear()`

Clears local caches of all entries.

## Entry & CachedEntry

The `Entry` and `CachedEntry` classes represent entry wrapped result values for metric tracking and viewing source of what level the data was fetched from

### `id`

Unique cache identifier

### `createdAt`

Timestamp of when the _local_ cache entry was created

### `source`

Source of where the value was fetched from

### `value`

Value of the cached entry. Optional for `Entry`, required for `CachedEntry`

### `error`

Optional exception that occurred during fetching of value

### `staleAt`

Timestamp in milliseconds of when the cache entry becomes stale (can still be used, just refreshed in the background)

### `expiresAt`

Timestamp in milliseconds of when the cache entry expires (can no longer be used)

### `upsertedAt`

Timestamp in milliseconds of when the cache

### `get isStale()`

Indicates if the entry is stale (can still be used, just past the ttl)

### `get isExpired()`

Indicates if the entry is still usable (past stale threshold)

## SingleKeyWorker

Cache worker for a single key entry

### `get()`

Fetches single cached value for this single key worker, throwing any errors that are found

### `getRequired()`

Fetches single cached value for this single key worker, throwing any returned errors and raising exception if value could not be found

### `upsert(skipRemoteCache?: boolean)`

Force updates local cache with value saved in remote cache or fetcher process

### `upsertRequired(skipRemoteCache?: boolean)`

Force updates local cache with value saved in remote cache or fetcher process, throwing an error if value could not be found

### `set(value: ResultType, ttl?: number)`

Sets cache entry in both remote and local caches, then signals to all other systems to update their locals

### `delete()`

Deletes cache entry in both remote and local caches, then signals to all other systems to delete cache entry from their locals if it exists

### `touch(ttl?: number)`

Extending ttl on the value. Signal will be sent to all workers, and remote cache will be touched in parallel

### `exists(skipLocalCache?: boolean)`

Identifies if the the value exist in either the local cache or the remote cache

### `broadcast(action: "upsert" | "delete")`

Broadcasts action to workers connected through the message broker

### `has()`

Indicates if the value exists in the local cache only

### `prefill(value: ResultType, ttl?: number)`

Inserts the provided list of entries into the local cache only, overriding any existing entries

### `peek()`

Returns local cache entry if it exists, undefined if it does not

## Message Broker (Keeping Workers in Sync)

While workers provide optimal performance in a single server setup, a big benefit of redis and memcache is around having the most recently cached data available for every app instance. The message broker provides an extensible interface to inject a pub/sub service for keeping worker caches in sync.

![pubsub](https://user-images.githubusercontent.com/204407/209453433-047501b7-4c51-4f0b-95b9-18c8aa22c32c.jpg)

### `setup(levelTwo: LevelTwo): Promise<void>`

Signal for when LevelTwo instance has been started

### `teardown(levelTwo: LevelTwo): Promise<void>`

Signal for when LevelTwo instance has been stopped

### `publish(action: DistributedAction): Promise<void>;`

Method for publishing actions that should be distributed to every LevelTwo process

### `subscribe(listener: (action: DistributedAction) => void): Promise<void>;`

Method for listening for actions that should be taken on every LevelTwo process

## Remote Cache (Persisting Cache Entries)

While workers are a more performant alternative to cache services like redis or memcache, they come with a flaw around persistence in that the cache is fully lost on any code deploy or application restart. If a worker fetch method has a heavy computational expense, this can become costly for cases like a flaky docker container that restarts often and has to re-trigger the fetch on each cycle.

The remote cache provides an extensible interface to keep a worker cache and external cache in sync. It does not listen to any changes in the remote cache itself, relying on end to end use of LevelTwo for signals to be sent properly for multi server cache updates.

### `setup(levelTwo: LevelTwo): Promise<void>`

Signal for when LevelTwo instance has been started

### `teardown(levelTwo: LevelTwo): Promise<void>`

Signal for when LevelTwo instance has been stopped

### `get(worker: WorkerIdentifierType, ids: any[], earlyWrite: (id: any, value: Result) => Promise<void>) => Promise<Result[] | Map<any, Result> | void>`

Fetching list of unique identifiers (namespaced by worker id) from external cache. This will be called before the actual worker is called. If a result is found, then the worker will not be called for that specific id.

**Note\***: Workers follow the BurstValve paradigm, which means multiple independent fetches could be waiting on this one call to complete. To follow that pattern, an early write mechanism is provided to unblock parallel queues as soon as data comes in

### `set(worker: WorkerIdentifierType, entries: CacheEntry[]): Promise<void>`

Setting new entries into the external cache. This is only triggered when a user declares a value has changed

### `delete(worker: WorkerIdentifierType, ids: any[]): Promise<void>`

Deleting data from an external cache. This is only triggered when a user declares a value has been removed

### `touch(worker: WorkerIdentifierType, ids: CacheTouch[]): Promise<void>`

Extending ttl on the ids provided. Should ignore any keys that don't exist

### `exists(worker: WorkerIdentifierType, ids: any[]): Promise<boolean[]>`

Checks to see if the ids provided exist in the remote cache
