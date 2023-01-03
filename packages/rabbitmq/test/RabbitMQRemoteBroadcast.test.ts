import { DistributedAction, LevelTwo } from "@level-two/core";
import { Channel, connect, Connection, ConsumeMessage } from "amqplib";
import { RabbitMQMessageBroker } from "../src";

jest.mock("amqplib");

describe("RabbitMQMessageBroker", () => {
  let messageBroker: RabbitMQMessageBroker<string>;
  let consumerChannel: Channel;
  let publisherChannel: Channel;
  let connection: Connection;
  let levelTwo: LevelTwo;

  beforeEach(async () => {
    let consumerChannelReturned = false;
    consumerChannel = {
      on: jest.fn(),
      assertExchange: jest.fn(),
      assertQueue: jest.fn().mockResolvedValue({ queue: "generated-foobar" }),
      bindQueue: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    } as any;
    publisherChannel = {
      on: jest.fn(),
      assertExchange: jest.fn(),
      publish: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    } as any;
    connection = {
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
      createChannel: jest.fn().mockImplementation(() => {
        if (consumerChannelReturned) {
          return publisherChannel;
        } else {
          consumerChannelReturned = true;
          return consumerChannel;
        }
      }),
    } as any;
    (connect as jest.Mock).mockReturnValue(connection);

    messageBroker = new RabbitMQMessageBroker({ url: "amqp://localhost" });
    levelTwo = new LevelTwo({ messageBroker });

    await messageBroker.setup(levelTwo);
  });

  test("should connect consumer and publisher channels on setup", async () => {
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenLastCalledWith("amqp://localhost");

    // RabbitMQ Connection
    expect(connection.on).toHaveBeenCalledTimes(1);
    expect(connection.on).toHaveBeenLastCalledWith(
      "error",
      expect.any(Function)
    );
    expect(connection.createChannel).toHaveBeenCalledTimes(2);

    // Consumer Channel
    expect(consumerChannel.on).toHaveBeenCalledTimes(1);
    expect(consumerChannel.on).toHaveBeenLastCalledWith(
      "error",
      expect.any(Function)
    );
    expect(consumerChannel.assertExchange).toHaveBeenCalledTimes(1);
    expect(consumerChannel.assertExchange).toHaveBeenLastCalledWith(
      "level-two-broadcast",
      "fanout",
      { durable: false }
    );
    expect(consumerChannel.assertQueue).toHaveBeenCalledTimes(1);
    expect(consumerChannel.assertQueue).toHaveBeenLastCalledWith("", undefined);
    expect(consumerChannel.bindQueue).toHaveBeenCalledTimes(1);
    expect(consumerChannel.bindQueue).toHaveBeenLastCalledWith(
      "generated-foobar",
      "level-two-broadcast",
      ""
    );
    expect(consumerChannel.consume).toHaveBeenCalledTimes(1);
    expect(consumerChannel.consume).toHaveBeenLastCalledWith(
      "generated-foobar",
      expect.any(Function),
      { noAck: true }
    );

    // Publisher Channel
    expect(publisherChannel.on).toHaveBeenCalledTimes(1);
    expect(publisherChannel.on).toHaveBeenLastCalledWith(
      "error",
      expect.any(Function)
    );
    expect(publisherChannel.assertExchange).toHaveBeenCalledTimes(1);
    expect(publisherChannel.assertExchange).toHaveBeenLastCalledWith(
      "level-two-broadcast",
      "fanout",
      { durable: false }
    );
  });

  test("should progate any connection or channel errors to levelTwo instance", async () => {
    let error: Error | undefined;
    levelTwo.on("error", (e) => (error = e));
    jest.spyOn(levelTwo, "emit");

    // Connection Errors
    (connection.on as jest.Mock).mock.calls[0][1]("Mock Connection Error");
    expect(levelTwo.emit).toHaveBeenCalledTimes(1);
    expect(levelTwo.emit).toHaveBeenLastCalledWith("error", error);
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toStrictEqual("RabbitMQ Connection Error");
    expect(error?.cause).toStrictEqual("Mock Connection Error");

    // Consumer Channel Errors
    error = undefined as Error | undefined;
    (levelTwo.emit as jest.Mock).mockClear();
    (consumerChannel.on as jest.Mock).mock.calls[0][1](
      "Mock Consumer Channel Error"
    );
    expect(levelTwo.emit).toHaveBeenCalledTimes(1);
    expect(levelTwo.emit).toHaveBeenLastCalledWith("error", error);
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toStrictEqual("RabbitMQ Consumer Channel Error");
    expect(error?.cause).toStrictEqual("Mock Consumer Channel Error");

    // Publisher Channel Errors
    error = undefined as Error | undefined;
    (levelTwo.emit as jest.Mock).mockClear();
    (publisherChannel.on as jest.Mock).mock.calls[0][1](
      "Mock Publisher Channel Error"
    );
    expect(levelTwo.emit).toHaveBeenCalledTimes(1);
    expect(levelTwo.emit).toHaveBeenLastCalledWith("error", error);
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toStrictEqual("RabbitMQ Publisher Channel Error");
    expect(error?.cause).toStrictEqual("Mock Publisher Channel Error");
  });

  test("should close both channels and connection on shutdown", async () => {
    await messageBroker.teardown();
    expect(consumerChannel.close).toHaveBeenCalledTimes(1);
    expect(publisherChannel.close).toHaveBeenCalledTimes(1);
    expect(connection.close).toHaveBeenCalledTimes(1);
  });

  test("should encode and distribute action to the broadcast channel on publish", async () => {
    await messageBroker.publish({
      worker: "customer",
      ids: ["github", "npm"],
      action: "upsert",
    });
    expect(publisherChannel.publish).toHaveBeenCalledTimes(1);
    expect(publisherChannel.publish).toHaveBeenLastCalledWith(
      "level-two-broadcast",
      "",
      expect.any(Buffer),
      undefined
    );
  });

  test("should throw an exception when attempting to publish without starting levelTwo first", async () => {
    const messageBroker = new RabbitMQMessageBroker({
      url: "amqp://localhost",
    });
    await expect(
      messageBroker.publish({
        worker: "customer",
        ids: ["github", "npm"],
        action: "upsert",
      })
    ).rejects.toThrow("RabbitMQ message broker not setup");
  });

  test("should just add the listener to the stack when subscribing", async () => {
    const listener = () => undefined;
    await messageBroker.subscribe(listener);
    expect((messageBroker as any).listeners).toEqual([listener]);
  });

  test("should parse and emit broadcasted messages that were published", async () => {
    let error: Error | undefined;
    levelTwo.on("error", (e) => (error = e));
    jest.spyOn(levelTwo, "emit");

    const localListener = jest.fn();
    await messageBroker.subscribe(localListener);

    const listener = (consumerChannel.consume as jest.Mock).mock
      .calls[0][1] as (message: Partial<ConsumeMessage> | null) => void;

    const action: DistributedAction<string, string> = {
      worker: "customer",
      ids: ["github", "npm"],
      action: "upsert",
    };
    listener({ content: Buffer.from(JSON.stringify(action)) });
    expect(localListener).toHaveBeenCalledTimes(1);
    expect(localListener).toHaveBeenLastCalledWith(action);

    localListener.mockClear();
    listener(null);
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toStrictEqual("Missing RabbitMQ consumer message");
    expect(levelTwo.emit).toHaveBeenCalledTimes(1);
    expect(levelTwo.emit).toHaveBeenLastCalledWith("error", error);
    expect(localListener).not.toHaveBeenCalled();

    (levelTwo.emit as jest.Mock).mockClear();
    listener({ content: Buffer.from("{throwError") });
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toStrictEqual("RabbitMQ consumer parsing error");
    expect(levelTwo.emit).toHaveBeenCalledTimes(1);
    expect(levelTwo.emit).toHaveBeenLastCalledWith("error", error);
    expect(localListener).not.toHaveBeenCalled();

    (levelTwo.emit as jest.Mock).mockClear();
    localListener.mockImplementation(() => {
      throw new Error("Mock Listener Error");
    });
    listener({ content: Buffer.from(JSON.stringify(action)) });
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toStrictEqual(
      "Uncaught RabbitMQ broadcast listener error"
    );
    expect(error?.cause).toBeInstanceOf(Error);
    expect((error?.cause as Error).message).toStrictEqual(
      `Mock Listener Error`
    );
    expect(levelTwo.emit).toHaveBeenCalledTimes(1);
    expect(levelTwo.emit).toHaveBeenLastCalledWith("error", error);
  });
});
