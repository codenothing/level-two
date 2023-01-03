import { createClient } from "redis";
import {
  createLevelTwoRedis,
  RedisMessageBroker,
  RedisRemoteCache,
} from "../src";

jest.mock("redis");

type RedisClientType = ReturnType<typeof createClient>;

describe("createLevelTwoRedis", () => {
  let redis: RedisClientType;

  beforeEach(() => {
    redis = {
      isOpen: false,
      duplicate: jest.fn(),
    } as any;
  });

  test("should use settings passed in when creating a levelTwo instance", () => {
    (redis.duplicate as jest.Mock).mockReturnValue(redis);

    const levelTwo = createLevelTwoRedis({
      redis,
      cacheDefaults: { ttl: 60000 },
    });
    expect(levelTwo.settings.cacheDefaults?.ttl).toStrictEqual(60000);
    expect(levelTwo.remoteCache).toBeInstanceOf(RedisRemoteCache);
    expect(
      (levelTwo.remoteCache as RedisRemoteCache<string>).redis
    ).toStrictEqual(redis);
    expect(redis.duplicate).toHaveBeenCalledTimes(1);
    expect(levelTwo.messageBroker).toBeInstanceOf(RedisMessageBroker);
    expect(
      (levelTwo.messageBroker as RedisMessageBroker<string>).producerRedis
    ).toStrictEqual(redis);
  });

  test("should create new instace of redis when passing in options", () => {
    (createClient as jest.Mock).mockReturnValue(redis);

    createLevelTwoRedis({ clientOptions: { url: "localhost:8964" } });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenLastCalledWith({ url: "localhost:8964" });
  });

  test("should disable use of remote cache when defined", () => {
    (redis.duplicate as jest.Mock).mockReturnValue(redis);

    const levelTwo = createLevelTwoRedis({ redis, cacheDisabled: true });
    expect(levelTwo.messageBroker).toBeInstanceOf(RedisMessageBroker);
    expect(
      (levelTwo.messageBroker as RedisMessageBroker<string>).producerRedis
    ).toStrictEqual(redis);
    expect(levelTwo.remoteCache).toBeUndefined();
  });
});
