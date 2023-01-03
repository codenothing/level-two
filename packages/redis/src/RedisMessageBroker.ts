import { DistributedAction, LevelTwo, MessageBroker } from "@level-two/core";
import { createClient } from "redis";
import { LevelTwoRedisSettings } from ".";

type RedisClientType = ReturnType<typeof createClient>;
type BroadcastListener<WorkerIdentifierType> = (
  action: DistributedAction<any, WorkerIdentifierType>
) => void;

const DEFAULT_BROADCAST_CHANNEL = "level-two-broadcast";

/**
 * Redis backed message broker extension for LevelTwo
 */
export class RedisMessageBroker<WorkerIdentifierType>
  implements MessageBroker<WorkerIdentifierType>
{
  /**
   * Redis extension settings
   */
  public readonly settings: LevelTwoRedisSettings<WorkerIdentifierType>;

  /**
   * Redis instance used for producing messages
   */
  public readonly producerRedis: RedisClientType;

  /**
   * Redis instance used for consuming messages
   */
  public readonly consumerRedis: RedisClientType;

  /**
   * Channel to use for broadcasting
   */
  public readonly broadcastChannel: string;

  /**
   * LevelTwo instance message broker is tied to
   */
  private levelTwo?: LevelTwo<WorkerIdentifierType>;

  /**
   * Stack of callback listeners for broadcast messages
   */
  private listeners: BroadcastListener<WorkerIdentifierType>[] = [];

  constructor(
    redis: RedisClientType,
    settings?: LevelTwoRedisSettings<WorkerIdentifierType>
  ) {
    this.producerRedis = redis;
    this.consumerRedis = redis.duplicate();
    this.settings = settings || {};
    this.broadcastChannel =
      this.settings.broadcastChannel || DEFAULT_BROADCAST_CHANNEL;
  }

  /**
   * Connects redis and starts the channel listener on setup
   * @param levelTwo LevelTwo instance being started
   */
  public async setup(levelTwo: LevelTwo<WorkerIdentifierType>): Promise<void> {
    this.levelTwo = levelTwo;
    if (!this.producerRedis.isOpen) {
      await this.producerRedis.connect();
    }
    if (!this.consumerRedis.isOpen) {
      await this.consumerRedis.connect();
    }

    // Open subscription for distributed action channel
    await this.consumerRedis.subscribe(this.broadcastChannel, (message) => {
      let action: DistributedAction<any, WorkerIdentifierType>;

      try {
        action = JSON.parse(message);
      } catch (e) {
        this.levelTwo?.emit(
          "error",
          new Error(`Unknown error occurred while parsing published message`, {
            cause: e,
          })
        );

        return;
      }

      this.listeners.forEach((listener) => {
        try {
          listener(action);
        } catch (e) {
          this.levelTwo?.emit(
            "error",
            new Error(`Uncaught broadcast listener error`, { cause: e })
          );
        }
      });
    });
  }

  /**
   * Shutdown redis connection on teardown
   */
  public async teardown(): Promise<void> {
    if (this.producerRedis.isOpen) {
      await this.producerRedis.quit();
    }
    if (this.consumerRedis.isOpen) {
      await this.consumerRedis.quit();
    }
  }

  /**
   * Publishes action to the broadcast channel
   * @param action Distributed action message to be sent to every instance
   */
  public async publish(
    action: DistributedAction<any, WorkerIdentifierType>
  ): Promise<void> {
    await this.producerRedis.publish(
      this.broadcastChannel,
      JSON.stringify(action)
    );
  }

  /**
   * Adds callback listener to the stack for triggering when actions come through
   * @param listener Action callback listener
   */
  public async subscribe(
    listener: (action: DistributedAction<any, WorkerIdentifierType>) => void
  ): Promise<void> {
    this.listeners.push(listener);
  }
}
