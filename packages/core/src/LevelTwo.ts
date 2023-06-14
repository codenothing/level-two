import EventEmitter from "events";
import {
  CacheSettings,
  DistributedAction,
  MessageBroker,
  SingleKeyWorkerFetchProcess,
  RemoteCache,
  WorkerFetchProcess,
} from "./interfaces";
import { SingleKeyWorker } from "./SingleKeyWorker";
import { Worker, WorkerSettings } from "./Worker";

/**
 * Settings for configuring a LevelTwo instance
 */
export interface LevelTwoSettings<
  WorkerIdentifierType = string,
  SingleKeyIdentifierType = string
> {
  /**
   * Optional external message broker to keep cache in sync with other apps
   */
  messageBroker?: MessageBroker<WorkerIdentifierType, SingleKeyIdentifierType>;

  /**
   * Optional external cache service for a secondary, more "persisted" cache
   */
  remoteCache?: RemoteCache<WorkerIdentifierType, SingleKeyIdentifierType>;

  /**
   * Default cache settings for each worker
   */
  cacheDefaults?: CacheSettings;
}

// LevelTwo specific events
export interface LevelTwo<WorkerIdentifierType = string> {
  on(event: "error", listener: (error: Error) => void): this;
  on(
    event: "action",
    listener: (action: DistributedAction<any, WorkerIdentifierType>) => void
  ): this;
  on(event: "setup", listener: () => void): this;
  on(event: "teardown", listener: () => void): this;

  once(event: "error", listener: (error: Error) => void): this;
  once(
    event: "action",
    listener: (action: DistributedAction<any, WorkerIdentifierType>) => void
  ): this;
  once(event: "setup", listener: () => void): this;
  once(event: "teardown", listener: () => void): this;

  off(event: "error", listener: (error: Error) => void): this;
  off(
    event: "action",
    listener: (action: DistributedAction<any, WorkerIdentifierType>) => void
  ): this;
  off(event: "setup", listener: () => void): this;
  off(event: "teardown", listener: () => void): this;

  emit(eventName: "error", error: Error): boolean;
  emit(
    eventName: "action",
    action: DistributedAction<any, WorkerIdentifierType>
  ): boolean;
  emit(eventName: "setup"): boolean;
  emit(eventName: "teardown"): boolean;
}

/**
 * Distributed in-process caching solution
 */
export class LevelTwo<
  WorkerIdentifierType = string,
  SingleKeyIdentifierType = string
> extends EventEmitter {
  /**
   * Global settings
   */
  public readonly settings: LevelTwoSettings<
    WorkerIdentifierType,
    SingleKeyIdentifierType
  >;

  /**
   * Reference to the remote cache interface
   */
  public readonly messageBroker?: MessageBroker<
    WorkerIdentifierType,
    SingleKeyIdentifierType
  >;

  /**
   * Reference to the remote cache interface
   */
  public readonly remoteCache?: RemoteCache<
    WorkerIdentifierType,
    SingleKeyIdentifierType
  >;

  /**
   * Hash of all existing workers
   */
  private workers = new Map<
    WorkerIdentifierType,
    Worker<any, any, WorkerIdentifierType, SingleKeyIdentifierType>
  >();

  /**
   * Internal reference to the shared worker for single key's
   */
  private internalSingleKeyWorker?: Worker<
    any,
    any,
    WorkerIdentifierType,
    SingleKeyIdentifierType
  >;

  /**
   * Storage for all single key worker fetchers
   */
  private singleKeyWorkerFetches = new Map<
    SingleKeyIdentifierType,
    SingleKeyWorkerFetchProcess<any>
  >();

  /**
   * Distributed in-process caching solution
   * @param settings LevelTwo settings
   */
  constructor(
    settings?: LevelTwoSettings<WorkerIdentifierType, SingleKeyIdentifierType>
  ) {
    super();
    this.settings = settings || {};
    this.messageBroker = settings?.messageBroker;
    this.remoteCache = settings?.remoteCache;
  }

  /**
   * Sets up the level two instance (and remove cache interface)
   */
  public async start(): Promise<void> {
    if (this.messageBroker?.setup) {
      await this.messageBroker.setup(this);
    }

    if (this.remoteCache?.setup) {
      await this.remoteCache.setup(this);
    }

    this.messageBroker?.subscribe((action) => this.emit("action", action));

    this.emit("setup");
  }

  /**
   * Tears down the level two instance (and remove cache interface)
   */
  public async stop(): Promise<void> {
    if (this.messageBroker?.teardown) {
      await this.messageBroker.teardown(this);
    }

    if (this.remoteCache?.teardown) {
      await this.remoteCache.teardown(this);
    }

    this.emit("teardown");
  }

  /**
   * Generates a cache worker for a specific namespace
   * @param workerId Name of the cache worker
   * @param worker Worker process for fetching uncached entries
   */
  public createWorker<ResultType, IdentifierType = string | number>(
    workerId: WorkerIdentifierType,
    worker: WorkerFetchProcess<ResultType, IdentifierType>
  ): Worker<
    ResultType,
    IdentifierType,
    WorkerIdentifierType,
    SingleKeyIdentifierType
  >;

  /**
   * Generates a cache worker for a specific namespace
   * @param settings Worker configuration settings
   */
  public createWorker<ResultType, IdentifierType = string | number>(
    settings: WorkerSettings<ResultType, IdentifierType, WorkerIdentifierType>
  ): Worker<
    ResultType,
    IdentifierType,
    WorkerIdentifierType,
    SingleKeyIdentifierType
  >;

  /**
   * Generates a cache worker for a specific namespace
   * @param settings Either worker name or worker configuration settings
   * @param worker Worker process for fetching uncached entries when only passing name in the first param
   */
  public createWorker<ResultType, IdentifierType = string | number>(
    settings:
      | WorkerSettings<ResultType, IdentifierType, WorkerIdentifierType>
      | WorkerIdentifierType,
    fetchProcess?: WorkerFetchProcess<ResultType, IdentifierType>
  ): Worker<
    ResultType,
    IdentifierType,
    WorkerIdentifierType,
    SingleKeyIdentifierType
  > {
    let config: WorkerSettings<
      ResultType,
      IdentifierType,
      WorkerIdentifierType
    >;

    if (fetchProcess !== undefined) {
      if (typeof fetchProcess !== "function") {
        throw new Error(`Worker function not found`);
      }

      config = {
        name: settings as WorkerIdentifierType,
        worker: fetchProcess,
      };
    } else {
      config = settings as WorkerSettings<
        ResultType,
        IdentifierType,
        WorkerIdentifierType
      >;
    }

    // Block duplicate workers
    if (this.workers.has(config.name)) {
      throw new Error(`LevelTwo Worker '${config.name}' already exists`);
    }

    const worker = new Worker<
      ResultType,
      IdentifierType,
      WorkerIdentifierType,
      SingleKeyIdentifierType
    >(this, config);

    // Only proxy worker errors if user hasn't already attached an error listener
    worker.on("error", (error) => {
      if (worker.listenerCount("error") < 2) {
        this.emit("error", error);
      }
    });

    this.workers.set(config.name, worker);

    return worker;
  }

  /**
   * Creates a single key worker with the identifier provided
   * @param id Unique identifier used for the whole worker
   * @param fetchProcess Process used to fetch the raw data for the identifier defined
   */
  public createSingleKeyWorker<ResultType>(
    id: SingleKeyIdentifierType,
    fetchProcess: SingleKeyWorkerFetchProcess<ResultType>
  ): SingleKeyWorker<
    ResultType,
    SingleKeyIdentifierType,
    WorkerIdentifierType
  > {
    if (this.singleKeyWorkerFetches.has(id)) {
      throw new Error(`LevelTwo Single Key Worker '${id}' already exists`);
    }
    this.singleKeyWorkerFetches.set(id, fetchProcess);

    if (!this.internalSingleKeyWorker) {
      this.internalSingleKeyWorker = new Worker<
        ResultType,
        any,
        WorkerIdentifierType,
        SingleKeyIdentifierType
      >(this, {
        name: "single-key-worker" as WorkerIdentifierType,
        worker: this.singleKeyWorkerFetcher.bind(this),
      });
    }

    return new SingleKeyWorker<
      ResultType,
      SingleKeyIdentifierType,
      WorkerIdentifierType
    >(id, this.internalSingleKeyWorker);
  }

  /**
   * Fetcher process for single key workers. Runs fetchers in parallel.
   * @param ids List of single key ids to fetch
   * @param earlyWrite Method to flush results as soon as they come in
   */
  private async singleKeyWorkerFetcher<ResultType>(
    ids: SingleKeyIdentifierType[],
    earlyWrite: Parameters<
      WorkerFetchProcess<ResultType, SingleKeyIdentifierType>
    >[1]
  ): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const id of ids) {
      const fetcher = this.singleKeyWorkerFetches.get(id);

      promises.push(
        new Promise<void>((resolve, reject) => {
          if (fetcher) {
            fetcher()
              .then((result) => {
                earlyWrite(id, result).then(resolve).catch(reject);
              })
              .catch(reject);
          } else {
            earlyWrite(
              id,
              new Error(`Missing fetch process for single key worker '${id}'`)
            )
              .then(resolve)
              .catch(reject);
          }
        })
      );
    }

    await Promise.all(promises);
  }
}
