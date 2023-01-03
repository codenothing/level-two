import { MemcachedRemoteCache } from "../src";
import Memcached from "memcached";

jest.mock("memcached");

describe("MemcachedRemoteCache", () => {
  let memcached: Memcached;
  let remoteCache: MemcachedRemoteCache;

  beforeEach(async () => {
    memcached = {
      end: jest.fn(),
      getMulti: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      touch: jest.fn(),
      exists: jest.fn(),
    } as any;
    remoteCache = new MemcachedRemoteCache("localhost:11211");
    (Memcached as unknown as jest.Mock).mockImplementation(() => memcached);
    await remoteCache.setup();
    (Memcached as unknown as jest.Mock).mockClear();
  });

  afterEach(async () => {
    await remoteCache.teardown();
  });

  test("should use cache prefix passed in the settings", () => {
    expect(remoteCache.cachePrefix).toStrictEqual("");

    remoteCache = new MemcachedRemoteCache("localhost:11211", {
      cachePrefix: "foobar",
    });
    expect(remoteCache.cachePrefix).toStrictEqual("foobar:");
  });

  test("should create the memcached instance on startup", async () => {
    const remoteCache = new MemcachedRemoteCache("localhost:11211", {
      clientOptions: { maxKeySize: 5000 },
    });
    await remoteCache.setup();
    expect(remoteCache.memcached).toStrictEqual(memcached);
    expect(Memcached).toHaveBeenCalledTimes(1);
    expect(Memcached).toHaveBeenLastCalledWith("localhost:11211", {
      maxKeySize: 5000,
    });
  });

  test("should throw error when trying to access memcached is setup", async () => {
    remoteCache = new MemcachedRemoteCache("localhost:11211");
    expect(() => remoteCache.memcached).toThrow(
      "Memcached remote cache not setup"
    );
  });

  test("should end memcached connection on shutdown", async () => {
    await remoteCache.teardown();
    expect(memcached.end).toHaveBeenCalledTimes(1);
  });

  test("should translate and fetch multiple keys at once", async () => {
    const github = JSON.stringify({ id: "github", name: "Github" });
    const npm = JSON.stringify({ id: "npm", name: "NPM" });
    (memcached.getMulti as jest.Mock).mockImplementation((_ids, callback) =>
      callback(null, { "customer:github": github, "customer:npm": npm })
    );
    const earlyWrite = jest.fn().mockResolvedValue(undefined);
    await remoteCache.get(
      "customer",
      ["github", "npm", "circleci"],
      earlyWrite
    );

    expect(memcached.getMulti).toHaveBeenCalledTimes(1);
    expect(memcached.getMulti).toHaveBeenLastCalledWith(
      ["customer:github", "customer:npm", "customer:circleci"],
      expect.any(Function)
    );
    expect(earlyWrite.mock.calls).toEqual([
      ["github", { id: "github", name: "Github" }],
      ["npm", { id: "npm", name: "NPM" }],
      ["circleci", undefined],
    ]);
  });

  test("should set multiple new keys with expiration times at once", async () => {
    (memcached.set as jest.Mock).mockImplementation(
      (_id, _value, _ttl, callback) => callback()
    );

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
    expect((memcached.set as jest.Mock).mock.calls).toEqual([
      [
        "customer:github",
        JSON.stringify({ id: "github", name: "Github" }),
        25,
        expect.any(Function),
      ],
      [
        "customer:npm",
        JSON.stringify({ id: "npm", name: "NPM" }),
        60,
        expect.any(Function),
      ],
    ]);
  });

  test("should delete multiple keys at once", async () => {
    (memcached.del as jest.Mock).mockImplementation((_id, callback) =>
      callback()
    );

    await remoteCache.delete("customer", ["github", "npm"]);
    expect((memcached.del as jest.Mock).mock.calls).toEqual([
      ["customer:github", expect.any(Function)],
      ["customer:npm", expect.any(Function)],
    ]);
  });

  test("should touch multiple keys at once", async () => {
    (memcached.touch as jest.Mock).mockImplementation((_id, _ttl, callback) =>
      callback()
    );

    await remoteCache.touch("customer", [
      { id: "github", ttl: 5000 },
      { id: "npm", ttl: 12000 },
    ]);
    expect((memcached.touch as jest.Mock).mock.calls).toEqual([
      ["customer:github", 5, expect.any(Function)],
      ["customer:npm", 12, expect.any(Function)],
    ]);
  });

  test("should check if keys exists by fetching and testing if they are strings", async () => {
    (memcached.getMulti as jest.Mock).mockImplementation((_ids, callback) =>
      callback(null, {
        github: JSON.stringify({ id: "github", name: "Github" }),
      })
    );

    expect(await remoteCache.exists("customer", ["github", "npm"])).toEqual([
      true,
      false,
    ]);
    expect((memcached.getMulti as jest.Mock).mock.calls).toEqual([
      [["customer:github", "customer:npm"], expect.any(Function)],
    ]);
  });
});
