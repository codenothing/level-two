import EventEmitter from "events";
import { Worker } from "./Worker";
import { Entry } from "./Entry";
import { CachedEntry } from "./CachedEntry";

// Worker specific events
export interface SingleKeyWorker<ResultType> {
  on(event: "upsert", listener: (value: ResultType, ttl: number) => void): this;
  on(event: "delete", listener: () => void): this;
  on(event: "touch", listener: (ttl: number) => void): this;
  on(event: "evict", listener: () => void): this;

  once(
    event: "upsert",
    listener: (value: ResultType, ttl: number) => void
  ): this;
  once(event: "delete", listener: () => void): this;
  once(event: "touch", listener: (ttl: number) => void): this;
  once(event: "evict", listener: () => void): this;

  off(
    event: "upsert",
    listener: (value: ResultType, ttl: number) => void
  ): this;
  off(event: "delete", listener: () => void): this;
  off(event: "touch", listener: (ttl: number) => void): this;
  off(event: "evict", listener: () => void): this;

  emit(eventName: "upsert", value: ResultType, ttl: number): boolean;
  emit(eventName: "delete"): boolean;
  emit(eventName: "touch", ttl: number): boolean;
  emit(eventName: "evict"): boolean;
}

/**
 * Cache worker for a single key entry
 */
export class SingleKeyWorker<
  ResultType,
  SingleKeyIdentifierType = string,
  WorkerIdentifierType = string
> extends EventEmitter {
  /**
   * Cache identifier to use in the base worker
   */
  public readonly id: SingleKeyIdentifierType;

  /**
   * Actual cache worker backing single key requests
   */
  private worker: Worker<
    ResultType,
    SingleKeyIdentifierType,
    WorkerIdentifierType,
    SingleKeyIdentifierType
  >;

  /**
   * Cache worker for a single key entry
   * @param id Unique identifier for the single key
   * @param worker Single key worker
   */
  constructor(
    id: SingleKeyIdentifierType,
    worker: Worker<
      ResultType,
      SingleKeyIdentifierType,
      WorkerIdentifierType,
      SingleKeyIdentifierType
    >
  ) {
    super();
    this.id = id;
    this.worker = worker;

    this.worker.on("upsert", (id, value, ttl) => {
      if (id === this.id) {
        this.emit("upsert", value, ttl);
      }
    });

    this.worker.on("delete", (id) => {
      if (id === this.id) {
        this.emit("delete");
      }
    });

    this.worker.on("touch", (id, ttl) => {
      if (id === this.id) {
        this.emit("touch", ttl);
      }
    });

    this.worker.on("evict", (id) => {
      if (id === this.id) {
        this.emit("evict");
      }
    });
  }

  /**
   * Fetches single cached value for this single key worker, throwing
   * any errors that are found
   */
  public async get(): Promise<ResultType | undefined> {
    return (await this.worker.getUnsafeMulti([this.id]))[0];
  }

  /**
   * Fetches single cached value for this single key worker, throwing
   * any returned errors and raising exception if value could not be found
   */
  public async getRequired(): Promise<ResultType> {
    return (await this.worker.getRequiredMulti([this.id]))[0];
  }

  /**
   * Fetches single entry wrapped value for this single key worker, the "source"
   * indicates at what point the value was retrieved from (local-cache, remote-cache, or worker)
   *
   * Exceptions are returned, not raised, and use the "error" source key
   */
  public async getEntry(): Promise<Entry<SingleKeyIdentifierType, ResultType>> {
    return (await this.worker.getEntryMulti([this.id]))[0];
  }

  /**
   * Force updates local cache with value saved in remote cache or fetcher process
   *
   * @param skipRemoteCache Skip remote cache, go directly to fetcher process for cache update
   */
  public async upsert(
    skipRemoteCache?: boolean
  ): Promise<ResultType | undefined> {
    return await this.worker.upsert(this.id, skipRemoteCache);
  }

  /**
   * Force updates local cache with value saved in remote cache or fetcher process, throwing an
   * error if value could not be found
   *
   * @param skipRemoteCache Skip remote cache, go directly to fetcher process for cache update
   */
  public async upsertRequired(
    skipRemoteCache?: boolean
  ): Promise<ResultType | undefined> {
    return await this.worker.upsertRequired(this.id, skipRemoteCache);
  }

  /**
   * Sets cache entry in both remote and local caches,
   * then signals to all other systems to update their locals
   *
   * @param value Result object to cache
   * @param ttl Amount of time in milliseconds before value is stale
   */
  public async set(value: ResultType, ttl?: number): Promise<void> {
    return await this.worker.set(this.id, value, ttl);
  }

  /**
   * Deletes cache entry in both remote and local caches,
   * then signals to all other systems to delete cache entry
   * from their locals if it exists
   */
  public async delete(): Promise<void> {
    return await this.worker.delete(this.id);
  }

  /**
   * Extending ttl on the value. Signal will be sent to all workers,
   * and remote cache will be touched in parallel
   *
   * @param ttl Optional custom time in milliseconds to extend each id. Defaults to worker ttl
   */
  public async touch(ttl?: number): Promise<void> {
    return await this.worker.touch(this.id, ttl);
  }

  /**
   * Identifies if the the value exist in either the
   * local cache or the remote cache
   *
   * @param skipLocalCache Indicates if local cache should be bypassed for existence check
   */
  public async exists(skipLocalCache?: boolean): Promise<boolean> {
    return await this.worker.exists(this.id, skipLocalCache);
  }

  /**
   * Broadcasts action to workers connected through the message broker
   * @param action Signal to send to other workers
   */
  public async broadcast(action: "upsert" | "delete"): Promise<void> {
    return await this.worker.broadcast(action, [this.id]);
  }

  /**
   * Indicates if the value exists in the local cache only
   */
  public has(): boolean {
    return this.worker.has(this.id);
  }

  /**
   * Inserts the provided list of entries into the local cache only, overriding
   * any existing entries
   *
   * @param value Value to set
   * @param ttl TTL to apply to the value
   */
  public prefill(value: ResultType, ttl?: number): void {
    return this.worker.prefill([{ id: this.id, value, ttl }]);
  }

  /**
   * Returns local cache entry if it exists, undefined if it does not
   */
  public peek(): CachedEntry<SingleKeyIdentifierType, ResultType> | undefined {
    return this.worker.peek(this.id);
  }
}
