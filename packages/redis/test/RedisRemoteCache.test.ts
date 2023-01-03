import { createClient } from "redis";
import { RedisRemoteCache } from "../src";

type RedisClientType = ReturnType<typeof createClient>;

describe("RedisRemoteCache", () => {
  let redis: RedisClientType;
  let remoteCache: RedisRemoteCache<string>;

  beforeEach(() => {
    redis = {
      isOpen: false,
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      mGet: jest.fn().mockResolvedValue(undefined),
      multi: jest.fn().mockResolvedValue(undefined),
    } as any;
    remoteCache = new RedisRemoteCache(redis);
  });

  test("should assign cache prefix when passed in through settings", () => {
    remoteCache = new RedisRemoteCache(redis, {
      cachePrefix: "redis-pref",
    });
    expect(remoteCache.cachePrefix).toStrictEqual("redis-pref:");
  });

  test("should connect to redis on setup", async () => {
    await remoteCache.setup();
    expect(redis.connect).toHaveBeenCalledTimes(1);
  });

  test("should quit redis connection on teardown", async () => {
    (redis as any).isOpen = true;
    await remoteCache.teardown();
    expect(redis.quit).toHaveBeenCalledTimes(1);
  });

  test("should translate and fetch multiple keys at once", async () => {
    const github = JSON.stringify({ id: "github", name: "Github" });
    const npm = JSON.stringify({ id: "npm", name: "NPM" });
    (redis.mGet as jest.Mock).mockResolvedValue([github, npm, null]);

    const earlyWrite = jest.fn().mockResolvedValue(undefined);
    await remoteCache.get(
      "customer",
      ["github", "npm", "circleci"],
      earlyWrite
    );

    expect(redis.mGet).toHaveBeenCalledTimes(1);
    expect(redis.mGet).toHaveBeenLastCalledWith([
      "customer:github",
      "customer:npm",
      "customer:circleci",
    ]);
    expect(earlyWrite.mock.calls).toEqual([
      ["github", { id: "github", name: "Github" }],
      ["npm", { id: "npm", name: "NPM" }],
      ["circleci", undefined],
    ]);
  });

  test("should set multiple new keys with expiration times at once", async () => {
    const multi = {
      setEx: jest.fn(),
      exec: jest.fn().mockResolvedValue(undefined),
    };
    multi.setEx.mockReturnValue(multi);
    (redis.multi as jest.Mock).mockReturnValue(multi);

    await remoteCache.set("customer", [
      {
        id: "github",
        value: { id: "github", name: "Github" },
        ttl: 25000,
      },
      {
        id: "npm",
        value: { id: "npm", name: "NPM" },
        ttl: 60000,
      },
    ]);
    expect(multi.setEx.mock.calls).toEqual([
      ["customer:github", 25, JSON.stringify({ id: "github", name: "Github" })],
      ["customer:npm", 60, JSON.stringify({ id: "npm", name: "NPM" })],
    ]);
    expect(multi.exec).toHaveBeenCalledTimes(1);
  });

  test("should delete multiple keys at once", async () => {
    const multi = {
      del: jest.fn(),
      exec: jest.fn().mockResolvedValue(undefined),
    };
    multi.del.mockReturnValue(multi);
    (redis.multi as jest.Mock).mockReturnValue(multi);

    await remoteCache.delete("customer", ["github", "npm"]);
    expect(multi.del.mock.calls).toEqual([
      ["customer:github"],
      ["customer:npm"],
    ]);
    expect(multi.exec).toHaveBeenCalledTimes(1);
  });

  test("should set new expiration times when touching multiple keys at once", async () => {
    const multi = {
      expire: jest.fn(),
      exec: jest.fn().mockResolvedValue(undefined),
    };
    multi.expire.mockReturnValue(multi);
    (redis.multi as jest.Mock).mockReturnValue(multi);

    await remoteCache.touch("customer", [
      {
        id: "github",
        ttl: 5000,
      },
      {
        id: "npm",
        ttl: 2000,
      },
    ]);
    expect(multi.expire.mock.calls).toEqual([
      ["customer:github", 5],
      ["customer:npm", 2],
    ]);
    expect(multi.exec).toHaveBeenCalledTimes(1);
  });

  test("should set new expiration times when touching multiple keys at once", async () => {
    const multi = {
      exists: jest.fn(),
      exec: jest.fn().mockResolvedValue([1, 0]),
    };
    multi.exists.mockReturnValue(multi);
    (redis.multi as jest.Mock).mockReturnValue(multi);

    expect(await remoteCache.exists("customer", ["github", "npm"])).toEqual([
      true,
      false,
    ]);
    expect(multi.exists.mock.calls).toEqual([
      ["customer:github"],
      ["customer:npm"],
    ]);
    expect(multi.exec).toHaveBeenCalledTimes(1);
  });
});
