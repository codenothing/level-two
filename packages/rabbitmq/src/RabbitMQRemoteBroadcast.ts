import {
  DistributedAction,
  LevelTwo,
  LevelTwoSettings,
  MessageBroker,
} from "@level-two/core";
import { connect, Connection, Options, Channel, ConsumeMessage } from "amqplib";

type BroadcastListener<WorkerIdentifierType> = (
  action: DistributedAction<any, WorkerIdentifierType>
) => void;

const DEFAULT_CHANNEL_NAME = `level-two-broadcast`;

/**
 * RabbitMQ extension settings
 */
export interface RabbitMQMessageBrokerParams<WorkerIdentifierType = string> {
  /**
   * Endpoint for connecting client to
   */
  url: string | Options.Connect;

  /**
   * Broadcast channel name for sending/receiving actions
   */
  broadcastChannel?: string;

  /**
   * Options when adding consumer listener
   */
  consumeOptions?: Options.Consume;

  /**
   * Options when declaring the consumer exchange
   */
  consumerExchangeOptions?: Options.AssertExchange;

  /**
   * Options when declaring the consumer queue
   */
  consumerQueueOptions?: Options.AssertQueue;

  /**
   * Options when publishing a message
   */
  publishOptions?: Options.Publish;

  /**
   * Options when declaring the publisher exchange
   */
  publisherExchangeOptions?: Options.AssertExchange;

  /**
   * LevelTwo remote cache extension
   */
  remoteCache?: LevelTwoSettings<WorkerIdentifierType>["remoteCache"];

  /**
   * LevelTwo worker cache defaults
   */
  cacheDefaults?: LevelTwoSettings<WorkerIdentifierType>["cacheDefaults"];
}

/**
 * RabbitMQ backed message broker extension for LevelTwo
 */
export class RabbitMQMessageBroker<WorkerIdentifierType = string>
  implements MessageBroker<WorkerIdentifierType>
{
  /**
   * RabbitMQ extension settings
   */
  public readonly settings: RabbitMQMessageBrokerParams<WorkerIdentifierType>;

  /**
   * Channel to use for broadcasting
   */
  public readonly broadcastChannel: string;

  /**
   * Reference to the RabbitMQ connection
   */
  private connection?: Connection;

  /**
   * Reference to the consumer rabbit channel
   */
  private consumerChannel?: Channel;

  /**
   * Reference to the publisher rabbit channel
   */
  private publisherChannel?: Channel;

  /**
   * LevelTwo instance message broker is tied to
   */
  private levelTwo?: LevelTwo<WorkerIdentifierType>;

  /**
   * Stack of callback listeners for broadcast messages
   */
  private listeners: BroadcastListener<WorkerIdentifierType>[] = [];

  constructor(settings: RabbitMQMessageBrokerParams<WorkerIdentifierType>) {
    this.settings = settings;
    this.broadcastChannel =
      this.settings.broadcastChannel || DEFAULT_CHANNEL_NAME;
  }

  /**
   * Connects rabbit, creates channels and starts the listener on startup
   * @param levelTwo LevelTwo instance being started
   */
  public async setup(levelTwo: LevelTwo<WorkerIdentifierType>): Promise<void> {
    this.levelTwo = levelTwo;

    // Setup connection
    this.connection = await connect(this.settings.url);
    this.connection.on("error", (e) =>
      this.levelTwo?.emit(
        "error",
        new Error(`RabbitMQ Connection Error`, { cause: e })
      )
    );

    // Setup consumer channel
    this.consumerChannel = await this.connection.createChannel();
    this.consumerChannel.on("error", (e) =>
      this.levelTwo?.emit(
        "error",
        new Error(`RabbitMQ Consumer Channel Error`, { cause: e })
      )
    );
    this.consumerChannel.assertExchange(
      this.broadcastChannel,
      "fanout",
      this.settings.consumerExchangeOptions || {
        durable: false,
      }
    );

    const queue = await this.consumerChannel.assertQueue(
      "",
      this.settings.consumerQueueOptions
    );
    await this.consumerChannel.bindQueue(
      queue.queue,
      this.broadcastChannel,
      ""
    );
    await this.consumerChannel.consume(
      queue.queue,
      this.incomingMessage.bind(this),
      this.settings.consumeOptions || { noAck: true }
    );

    // Setup publisher channel
    this.publisherChannel = await this.connection.createChannel();
    this.publisherChannel.on("error", (e) =>
      this.levelTwo?.emit(
        "error",
        new Error(`RabbitMQ Publisher Channel Error`, { cause: e })
      )
    );
    this.publisherChannel.assertExchange(
      this.broadcastChannel,
      "fanout",
      this.settings.publisherExchangeOptions || {
        durable: false,
      }
    );
  }

  /**
   * Shutdown channels and rabbit connection on teardown
   */
  public async teardown(): Promise<void> {
    await this.consumerChannel?.close();
    await this.publisherChannel?.close();
    await this.connection?.close();
  }

  /**
   * Publishes action to the broadcast channel
   * @param action Distributed action message to be sent to every instance
   */
  public async publish(
    action: DistributedAction<any, WorkerIdentifierType>
  ): Promise<void> {
    if (!this.publisherChannel) {
      throw new Error(`RabbitMQ message broker not setup`);
    }

    this.publisherChannel.publish(
      this.broadcastChannel,
      "",
      Buffer.from(JSON.stringify(action)),
      this.settings.publishOptions
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

  /**
   * Handles incoming messages from the broadcast channel
   * @param message Incoming message object
   */
  private incomingMessage(message: ConsumeMessage | null): void {
    let action: DistributedAction<any, WorkerIdentifierType>;

    if (!message) {
      this.levelTwo?.emit(
        "error",
        new Error(`Missing RabbitMQ consumer message`)
      );
      return;
    }

    try {
      action = JSON.parse(message.content.toString("utf-8"));
    } catch (e) {
      this.levelTwo?.emit(
        "error",
        new Error(`RabbitMQ consumer parsing error`, { cause: e })
      );
      return;
    }

    this.listeners.forEach((listener) => {
      try {
        listener(action);
      } catch (e) {
        this.levelTwo?.emit(
          "error",
          new Error(`Uncaught RabbitMQ broadcast listener error`, {
            cause: e,
          })
        );
      }
    });
  }
}
