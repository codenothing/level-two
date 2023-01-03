import { DistributedAction, LevelTwo } from "@level-two/core";
import { createClient } from "redis";
import { RedisMessageBroker } from "../src";

type RedisClientType = ReturnType<typeof createClient>;
type BroadcastListener = (action: DistributedAction<any, string>) => void;

describe("RedisMessageBroker", () => {
  let redis: RedisClientType;
  let consumerRedis: RedisClientType;
  let messageBroker: RedisMessageBroker<string>;
  let levelTwo: LevelTwo;
  let listener: (message: string) => void;

  beforeEach(() => {
    consumerRedis = {
      isOpen: false,
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockImplementation(async (_channel, lis) => {
        listener = lis;
      }),
    } as any;
    redis = {
      isOpen: false,
      duplicate: jest.fn().mockReturnValue(consumerRedis),
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn().mockResolvedValue(undefined),
    } as any;
    messageBroker = new RedisMessageBroker(redis);
    levelTwo = new LevelTwo({ messageBroker });
  });

  test("should use broadcast channel name passed in", async () => {
    messageBroker = new RedisMessageBroker(redis, {
      broadcastChannel: "foobar",
    });
    expect(messageBroker.producerRedis).toStrictEqual(redis);
    expect(messageBroker.broadcastChannel).toStrictEqual("foobar");
  });

  test("should connect redis and setup broadcast listener on setup", async () => {
    await messageBroker.setup(levelTwo);
    expect(redis.connect).toHaveBeenCalledTimes(1);
    expect(consumerRedis.connect).toHaveBeenCalledTimes(1);
    expect(consumerRedis.subscribe).toHaveBeenCalledTimes(1);
    expect(consumerRedis.subscribe).toHaveBeenLastCalledWith(
      `level-two-broadcast`,
      expect.any(Function)
    );
  });

  test("should parse and emit broadcasted messages that were published", async () => {
    let error: Error | undefined;
    levelTwo.on("error", (e) => (error = e));
    jest.spyOn(levelTwo, "emit");

    await messageBroker.setup(levelTwo);

    const localListener = jest.fn();
    await messageBroker.subscribe(localListener);

    const action: DistributedAction<string, string> = {
      worker: "customer",
      ids: ["github", "npm"],
      action: "upsert",
    };
    listener(JSON.stringify(action));
    expect(localListener).toHaveBeenCalledTimes(1);
    expect(localListener).toHaveBeenLastCalledWith(action);

    localListener.mockClear();
    listener("{throwError");
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toStrictEqual(
      "Unknown error occurred while parsing published message"
    );
    expect(levelTwo.emit).toHaveBeenCalledTimes(1);
    expect(levelTwo.emit).toHaveBeenLastCalledWith("error", error);
    expect(localListener).not.toHaveBeenCalled();

    (levelTwo.emit as jest.Mock).mockClear();
    localListener.mockImplementation(() => {
      throw new Error("Mock Listener Error");
    });
    listener(JSON.stringify(action));
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toStrictEqual("Uncaught broadcast listener error");
    expect(levelTwo.emit).toHaveBeenCalledTimes(1);
    expect(levelTwo.emit).toHaveBeenLastCalledWith("error", error);
  });

  test("should close the redis connection on teardown", async () => {
    (redis as any).isOpen = true;
    (consumerRedis as any).isOpen = true;
    await messageBroker.teardown();
    expect(redis.quit).toHaveBeenCalledTimes(1);
    expect(consumerRedis.quit).toHaveBeenCalledTimes(1);
  });

  test("should send action to broadcast channel when publishing", async () => {
    const action: DistributedAction<string, string> = {
      worker: "customer",
      ids: ["github", "npm"],
      action: "upsert",
    };
    await messageBroker.publish(action);
    expect(redis.publish).toHaveBeenCalledTimes(1);
    expect(redis.publish).toHaveBeenLastCalledWith(
      "level-two-broadcast",
      JSON.stringify(action)
    );
  });

  test("should just add the listener to the stack when subscribing", async () => {
    const listener: BroadcastListener = () => undefined;
    await messageBroker.subscribe(listener);
    expect((messageBroker as any).listeners).toEqual([listener]);
  });
});
