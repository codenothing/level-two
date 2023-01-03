import {
  DistributedAction,
  LevelTwo,
  LevelTwoSettings,
  MessageBroker,
} from "@level-two/core";
import {
  Consumer,
  ConsumerConfig,
  Kafka,
  KafkaConfig,
  Producer,
  ProducerConfig,
} from "kafkajs";

type BroadcastListener<WorkerIdentifierType> = (
  action: DistributedAction<any, WorkerIdentifierType>
) => void;

/**
 * Kafka extension settings
 */
export interface KafkaMessageBrokerSettings<WorkerIdentifierType = string> {
  /**
   * Topic name for sending/receiving actions
   */
  topic: string;

  /**
   * Kafka client options
   */
  clientOptions: KafkaConfig;

  /**
   * Consumer connection options
   */
  consumerOptions?: ConsumerConfig;

  /**
   * Producer connection options
   */
  producerOptions?: ProducerConfig;

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
 * Kafka backed message broker extension for LevelTwo
 */
export class KafkaMessageBroker<WorkerIdentifierType>
  implements MessageBroker<WorkerIdentifierType>
{
  /**
   * Kafka extension settings
   */
  public readonly settings: KafkaMessageBrokerSettings<WorkerIdentifierType>;

  /**
   * Kafka client instance
   */
  public readonly kafka: Kafka;

  /**
   * Consumer connection
   */
  public readonly consumer: Consumer;

  /**
   * Producer connection
   */
  public readonly producer: Producer;

  /**
   * LevelTwo instance broker is tied to
   */
  private levelTwo?: LevelTwo<WorkerIdentifierType>;

  /**
   * Stack of callback listeners for broadcast messages
   */
  private listeners: BroadcastListener<WorkerIdentifierType>[] = [];

  constructor(settings: KafkaMessageBrokerSettings<WorkerIdentifierType>) {
    this.settings = settings;
    this.kafka = new Kafka(this.settings.clientOptions);
    this.consumer = this.kafka.consumer(
      this.settings.consumerOptions || {
        groupId: `level-two-kafka-${Date.now()}`,
      }
    );
    this.producer = this.kafka.producer(this.settings.producerOptions);
  }

  /**
   * Connects both the consumer and producer connections on startup
   * @param levelTwo LevelTwo instance being started
   */
  public async setup(levelTwo: LevelTwo<WorkerIdentifierType>): Promise<void> {
    this.levelTwo = levelTwo;
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: this.settings.topic,
    });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        let action: DistributedAction<any, WorkerIdentifierType>;

        if (!message.value) {
          this.levelTwo?.emit(
            "error",
            new Error(`Missing Kafka message value`)
          );
          return;
        }

        try {
          action = JSON.parse(message.value.toString("utf-8"));
        } catch (e) {
          this.levelTwo?.emit(
            "error",
            new Error(`Unknown Kafka consumer parsing error`, { cause: e })
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
      },
    });

    await this.producer.connect();
  }

  /**
   * Ends the consumer and producer connections on shutdown
   */
  public async teardown(): Promise<void> {
    await this.consumer.disconnect();
    await this.producer.disconnect();
  }

  /**
   * Publishes action to the broadcast channel
   * @param action Distributed action message to be sent to every instance
   */
  public async publish(
    action: DistributedAction<any, WorkerIdentifierType>
  ): Promise<void> {
    await this.producer.send({
      topic: this.settings.topic,
      messages: [{ value: JSON.stringify(action) }],
    });
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
