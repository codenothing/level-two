import { Kafka, Consumer, Producer } from "kafkajs";
import { createLevelTwoKafka, KafkaMessageBroker } from "../src";

jest.mock("kafkajs");

describe("createLevelTwoKafka", () => {
  let kafka: Kafka;
  let consumer: Consumer;
  let producer: Producer;

  beforeEach(() => {
    consumer = {
      connect: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockResolvedValue(undefined),
      run: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
    } as any;
    producer = {
      connect: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
    } as any;
    kafka = {
      consumer: jest.fn().mockReturnValue(consumer),
      producer: jest.fn().mockReturnValue(producer),
    } as any;
    (Kafka as jest.Mock).mockReturnValue(kafka);
  });

  test("should create a new levelTwo instance with kafka configured", () => {
    const levelTwo = createLevelTwoKafka({
      topic: "kafka-foobar",
      clientOptions: {
        brokers: ["localhost:9092"],
      },
    });
    const messageBroker = levelTwo.messageBroker as KafkaMessageBroker<string>;

    expect(messageBroker.kafka).toEqual(kafka);
    expect(messageBroker.consumer).toEqual(consumer);
    expect(messageBroker.producer).toEqual(producer);
  });
});
