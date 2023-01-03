import EventEmitter from "events";
import {
  CacheSettings,
  DistributedAction,
  MessageBroker,
  RemoteCache,
  WorkerFetchProcess,
} from "./interfaces";
import { Worker, WorkerSettings } from "./Worker";

/**
 * Settings for configuring a LevelTwo instance
 */
export interface LevelTwoSettings<WorkerIdentifierType = string> {
  /**
   * Optional external message broker to keep cache in sync with other apps
   */
  messageBroker?: MessageBroker<WorkerIdentifierType>;

  /**
   * Optional external cache service for a secondary, more "persisted" cache
   */
  remoteCache?: RemoteCache<WorkerIdentifierType>;

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
export class LevelTwo<WorkerIdentifierType = string> extends EventEmitter {
  /**
   * Global settings
   */
  public readonly settings: LevelTwoSettings<WorkerIdentifierType>;

  /**
   * Reference to the remote cache interface
   */
  public readonly messageBroker?: MessageBroker<WorkerIdentifierType>;

  /**
   * Reference to the remote cache interface
   */
  public readonly remoteCache?: RemoteCache<WorkerIdentifierType>;

  /**
   * Hash of all existing workers
   */
  private workers = new Map<
    WorkerIdentifierType,
    Worker<any, any, WorkerIdentifierType>
  >();

  /**
   * Distributed in-process caching solution
   * @param settings LevelTwo settings
   */
  constructor(settings?: LevelTwoSettings<WorkerIdentifierType>) {
    super();
    this.settings = settings || {};
    this.messageBroker = settings?.messageBroker;
    this.remoteCache = settings?.remoteCache;
  }

  /**
   * Sets up the level one instance (and remove cache interface)
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
   * Tears down the level one instance (and remove cache interface)
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
  ): Worker<ResultType, IdentifierType, WorkerIdentifierType>;

  /**
   * Generates a cache worker for a specific namespace
   * @param settings Worker configuration settings
   */
  public createWorker<ResultType, IdentifierType = string | number>(
    settings: WorkerSettings<ResultType, IdentifierType, WorkerIdentifierType>
  ): Worker<ResultType, IdentifierType, WorkerIdentifierType>;

  /**
   * Generates a cache worker for a specific namespace
   * @param settings Either worker name or worker configuration settings
   * @param worker Worker process for fetching uncached entries when only passing name in the first param
   */
  public createWorker<ResultType, IdentifierType = string | number>(
    settings:
      | WorkerSettings<ResultType, IdentifierType, WorkerIdentifierType>
      | WorkerIdentifierType,
    worker?: WorkerFetchProcess<ResultType, IdentifierType>
  ): Worker<ResultType, IdentifierType, WorkerIdentifierType> {
    let config: WorkerSettings<
      ResultType,
      IdentifierType,
      WorkerIdentifierType
    >;

    if (worker !== undefined) {
      if (typeof worker !== "function") {
        throw new Error(`Worker function not found`);
      }

      config = {
        name: settings as WorkerIdentifierType,
        worker,
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
    } else {
      const worker = new Worker<
        ResultType,
        IdentifierType,
        WorkerIdentifierType
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
  }
}
