import { DistributedAction, LevelTwo } from "@level-two/core";
import { Kafka, Consumer, Producer } from "kafkajs";
import { KafkaMessageBroker } from "../src";

jest.mock("kafkajs");

describe("KafkaMessageBroker", () => {
  let messageBroker: KafkaMessageBroker<string>;
  let levelTwo: LevelTwo;
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

    messageBroker = new KafkaMessageBroker({
      topic: "kafka-foobar",
      clientOptions: {
        brokers: ["localhost:9092"],
      },
    });
    levelTwo = new LevelTwo({ messageBroker });
  });

  test("should connect consumer and producer on setup", async () => {
    await messageBroker.setup(levelTwo);
    expect(consumer.connect).toHaveBeenCalledTimes(1);
    expect(consumer.subscribe).toHaveBeenCalledTimes(1);
    expect(consumer.subscribe).toHaveBeenLastCalledWith({
      topic: "kafka-foobar",
    });
    expect(consumer.run).toHaveBeenCalledTimes(1);
    expect(consumer.run).toHaveBeenLastCalledWith({
      eachMessage: expect.any(Function),
    });
    expect(producer.connect).toHaveBeenCalledTimes(1);
  });

  describe("eachmessage", () => {
    let eachMessage: (row: {
      message: { value: Buffer | null };
    }) => Promise<void>;

    beforeEach(async () => {
      await messageBroker.setup(levelTwo);
      eachMessage = (consumer.run as jest.Mock).mock.calls[0][0].eachMessage;
    });

    test("should connect consumer and producer on setup", async () => {
      const listener = jest.fn();
      messageBroker.subscribe(listener);

      await eachMessage({
        message: {
          value: Buffer.from(
            JSON.stringify({
              worker: "customer",
              ids: ["github", "npm"],
              action: "upsert",
            })
          ),
        },
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenLastCalledWith({
        worker: "customer",
        ids: ["github", "npm"],
        action: "upsert",
      });
    });

    test("should pipe listener exceptions through levelTwo event emitter", async () => {
      const listener = jest.fn().mockImplementation(() => {
        throw new Error("Mock Listener Error");
      });
      messageBroker.subscribe(listener);

      let error: Error | undefined;
      levelTwo.on("error", (e) => (error = e));

      jest.spyOn(levelTwo, "emit");

      await eachMessage({
        message: {
          value: Buffer.from("{}"),
        },
      });

      expect(levelTwo.emit).toHaveBeenCalledTimes(1);
      expect(levelTwo.emit).toHaveBeenLastCalledWith("error", error);
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toStrictEqual("Uncaught broadcast listener error");
      expect(error?.cause).toBeInstanceOf(Error);
      expect((error?.cause as Error).message).toStrictEqual(
        "Mock Listener Error"
      );
    });

    test("should pipe parsing exceptions through levelTwo event emitter", async () => {
      let error: Error | undefined;
      levelTwo.on("error", (e) => (error = e));

      jest.spyOn(levelTwo, "emit");

      await eachMessage({
        message: {
          value: Buffer.from("{levelTwo}"),
        },
      });

      expect(levelTwo.emit).toHaveBeenCalledTimes(1);
      expect(levelTwo.emit).toHaveBeenLastCalledWith("error", error);
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toStrictEqual(
        "Unknown Kafka consumer parsing error"
      );
    });

    test("should pipe missing value exceptions through levelTwo event emitter", async () => {
      let error: Error | undefined;
      levelTwo.on("error", (e) => (error = e));

      jest.spyOn(levelTwo, "emit");

      await eachMessage({
        message: {
          value: null,
        },
      });

      expect(levelTwo.emit).toHaveBeenCalledTimes(1);
      expect(levelTwo.emit).toHaveBeenLastCalledWith("error", error);
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toStrictEqual("Missing Kafka message value");
    });
  });

  test("should disconnect the consumer and producer on shutdown", async () => {
    await messageBroker.teardown();
    expect(consumer.disconnect).toHaveBeenCalledTimes(1);
    expect(producer.disconnect).toHaveBeenCalledTimes(1);
  });

  test("should send action to the broadcast channel when publishing", async () => {
    const action: DistributedAction<any, string> = {
      worker: "customer",
      ids: ["github", "npm"],
      action: "upsert",
    };
    await messageBroker.publish(action);

    expect(producer.send).toHaveBeenCalledTimes(1);
    expect(producer.send).toHaveBeenLastCalledWith({
      topic: "kafka-foobar",
      messages: [{ value: JSON.stringify(action) }],
    });
  });

  test("should just add the listener to the stack when subscribing", async () => {
    const listener = () => undefined;
    await messageBroker.subscribe(listener);
    expect((messageBroker as any).listeners).toEqual([listener]);
  });
});
