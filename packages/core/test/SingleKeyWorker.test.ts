import { LevelTwo, SingleKeyWorker } from "../src";
import {
  getMockedMessageBroker,
  getMockedRemoteCache,
  MockMessageBroker,
  MockRemoteCache,
  wait,
} from "./utils";

interface TokensResultObject {
  github: string;
  npm: string;
}

describe("SingleKeyWorker", () => {
  let levelTwo: LevelTwo;
  let messageBroker: MockMessageBroker;
  let remoteCache: MockRemoteCache;
  let fetchProcess: jest.Mock;
  let worker: SingleKeyWorker<TokensResultObject, string, string>;

  beforeEach(async () => {
    messageBroker = getMockedMessageBroker();
    remoteCache = getMockedRemoteCache();
    levelTwo = new LevelTwo({
      messageBroker,
      remoteCache,
      cacheDefaults: { ttl: 50, staleCacheThreshold: 200 },
    });
    await levelTwo.start();

    fetchProcess = jest.fn().mockResolvedValue({
      github: "abc123",
      npm: "xyz456",
    });
    worker = levelTwo.createSingleKeyWorker<TokensResultObject>(
      "tokens",
      fetchProcess
    );
  });

  afterEach(async () => {
    await levelTwo.stop();
  });

  test("get should proxy through the base worker and trigger the process handler", async () => {
    expect(await worker.get()).toEqual({
      github: "abc123",
      npm: "xyz456",
    });
    expect(remoteCache.get).toHaveBeenCalledTimes(1);
    expect(remoteCache.get).toHaveBeenLastCalledWith(
      "single-key-worker",
      ["tokens"],
      expect.any(Function)
    );
    expect(fetchProcess).toHaveBeenCalledTimes(1);

    // Should reuse the cached version
    (remoteCache.get as jest.Mock).mockClear();
    fetchProcess.mockClear();
    expect(await worker.get()).toEqual({
      github: "abc123",
      npm: "xyz456",
    });
    expect(remoteCache.get).not.toHaveBeenCalled();
    expect(fetchProcess).not.toHaveBeenCalled();
  });

  test("get should skip fully expired entries and refetch the data", async () => {
    worker.prefill({
      github: "def456",
      npm: "hgi789",
    });
    expect(worker.has()).toStrictEqual(true);
    await wait(250);
    expect(worker.has()).toStrictEqual(false);
    expect(await worker.get()).toEqual({
      github: "abc123",
      npm: "xyz456",
    });
    expect(fetchProcess).toHaveBeenCalledTimes(1);
  });

  test("getRequired should throw an error when no value can be found", async () => {
    fetchProcess.mockResolvedValue(undefined);
    await expect(worker.getRequired()).rejects.toThrow(
      `Missing values for 'tokens' in 'single-key-worker' worker`
    );
    expect(remoteCache.get).toHaveBeenCalledTimes(1);
    expect(fetchProcess).toHaveBeenCalledTimes(1);

    // Confirm call is successful when there is a value
    fetchProcess.mockResolvedValue({
      github: "abc123",
      npm: "xyz456",
    });
    expect(await worker.getRequired()).toEqual({
      github: "abc123",
      npm: "xyz456",
    });
    expect(remoteCache.get).toHaveBeenCalledTimes(2);
    expect(fetchProcess).toHaveBeenCalledTimes(2);
  });

  test("upsert should skip locally cached entries and replace with new results", async () => {
    worker.prefill({ github: "abc123", npm: "xyz456" });

    // Calling upsert should return the new value
    (remoteCache.get as jest.Mock).mockResolvedValue([
      { github: "def789", npm: "tuv789" },
    ]);
    expect(await worker.upsert()).toEqual({ github: "def789", npm: "tuv789" });
    expect(remoteCache.get).toHaveBeenCalledTimes(1);
    expect(fetchProcess).not.toHaveBeenCalled();
    expect(worker.peek()).toEqual({ github: "def789", npm: "tuv789" });

    // get method should use the new cached entries
    (remoteCache.get as jest.Mock).mockClear();
    expect(await worker.get()).toEqual({ github: "def789", npm: "tuv789" });
    expect(remoteCache.get).not.toHaveBeenCalled();
  });

  test("upsert should skip remote cache when passed to upsert", async () => {
    worker.prefill({ github: "abc123", npm: "xyz456" });

    // Calling upsert should return the new value
    (remoteCache.get as jest.Mock).mockResolvedValue([
      { github: "def789", npm: "tuv789" },
    ]);
    fetchProcess.mockResolvedValue({ github: "ghi321", npm: "mno654" });
    expect(await worker.upsert(true)).toEqual({
      github: "ghi321",
      npm: "mno654",
    });
    expect(remoteCache.get).not.toHaveBeenCalled();
    expect(fetchProcess).toHaveBeenCalledTimes(1);
    expect(worker.peek()).toEqual({ github: "ghi321", npm: "mno654" });

    // get method should use the new cached entries
    (remoteCache.get as jest.Mock).mockClear();
    expect(await worker.get()).toEqual({ github: "ghi321", npm: "mno654" });
    expect(remoteCache.get).not.toHaveBeenCalled();
  });

  test("upsertRequired should throw an error if value is not found", async () => {
    fetchProcess.mockResolvedValue(undefined);
    await expect(worker.upsertRequired()).rejects.toThrow(
      `Missing upserted values for 'tokens' in 'single-key-worker' worker`
    );

    // Confirm when value exists, it returns properly
    fetchProcess.mockResolvedValue({
      github: "abc123",
      npm: "xyz456",
    });
    expect(await worker.upsertRequired()).toEqual({
      github: "abc123",
      npm: "xyz456",
    });
  });

  test("should set entry into both local and remote cache before publishing a distributed action", async () => {
    expect(worker.peek()).toEqual(undefined);
    await worker.set({ github: "abc123", npm: "xyz456" }, 1200);
    expect(worker.peek()).toEqual({ github: "abc123", npm: "xyz456" });
    expect(remoteCache.set).toHaveBeenCalledTimes(1);
    expect(remoteCache.set).toHaveBeenLastCalledWith(`single-key-worker`, [
      {
        id: `tokens`,
        ttl: 1200,
        value: { github: "abc123", npm: "xyz456" },
      },
    ]);
    expect(messageBroker.publish).toHaveBeenCalledTimes(1);
    expect(messageBroker.publish).toHaveBeenLastCalledWith({
      action: `upsert`,
      worker: `single-key-worker`,
      ids: [`tokens`],
      ttls: [1200],
    });
  });

  test("should delete entry from both local and remote cache", async () => {
    expect(await worker.get()).toEqual({ github: "abc123", npm: "xyz456" });

    await worker.delete();
    expect(worker.peek()).toEqual(undefined);
    expect(remoteCache.delete).toHaveBeenCalledTimes(1);
    expect(remoteCache.delete).toHaveBeenLastCalledWith("single-key-worker", [
      "tokens",
    ]);
    expect(messageBroker.publish).toHaveBeenCalledTimes(1);
    expect(messageBroker.publish).toHaveBeenLastCalledWith({
      action: "delete",
      worker: "single-key-worker",
      ids: ["tokens"],
    });
  });

  test("touch should signal to all applications to extend ttl", async () => {
    worker.prefill({ github: "abc123", npm: "xyz456" });
    await worker.touch(1200);

    expect(remoteCache.touch).toHaveBeenCalledTimes(1);
    expect(remoteCache.touch).toHaveBeenLastCalledWith("single-key-worker", [
      { id: "tokens", ttl: 1200 },
    ]);
    expect(messageBroker.publish).toHaveBeenCalledTimes(1);
    expect(messageBroker.publish).toHaveBeenLastCalledWith({
      action: "touch",
      worker: "single-key-worker",
      ids: ["tokens"],
      ttls: [1200],
    });
  });

  test("exists should check local cache before checking remote cache", async () => {
    expect(await worker.exists()).toStrictEqual(false);
    expect(remoteCache.exists).toHaveBeenCalledTimes(1);
    expect(remoteCache.exists).toHaveBeenLastCalledWith("single-key-worker", [
      "tokens",
    ]);

    // Should check local cache and return
    (remoteCache.exists as jest.Mock).mockClear();
    await worker.get();
    expect(await worker.exists()).toStrictEqual(true);
    expect(remoteCache.exists).not.toHaveBeenCalled();

    // Skipping local cache should test remote cache
    expect(await worker.exists(true)).toStrictEqual(true);
    expect(remoteCache.exists).toHaveBeenCalledTimes(1);
  });

  test("broadcast should send signal to all workers", async () => {
    await worker.broadcast("upsert");
    expect(messageBroker.publish).toHaveBeenCalledTimes(1);
    expect(messageBroker.publish).toHaveBeenLastCalledWith({
      action: "upsert",
      worker: "single-key-worker",
      ids: ["tokens"],
      ttl: undefined,
    });
  });

  test("has should validate if value exists locally", () => {
    expect(worker.has()).toStrictEqual(false);
    worker.prefill({ github: "abc123", npm: "xyz456" });
    expect(worker.has()).toStrictEqual(true);
  });

  test("prefill should override local cache", () => {
    expect(worker.peek()).toStrictEqual(undefined);
    worker.prefill({ github: "abc123", npm: "xyz456" });
    expect(worker.peek()).toEqual({ github: "abc123", npm: "xyz456" });
    worker.prefill({ github: "abc654", npm: "xyz987" });
    expect(worker.peek()).toEqual({ github: "abc654", npm: "xyz987" });
  });

  test("peek should return local cache data only", async () => {
    expect(worker.peek()).toStrictEqual(undefined);
    worker.prefill({ github: "abc123", npm: "xyz456" });
    expect(worker.peek()).toEqual({ github: "abc123", npm: "xyz456" });
  });

  test("should be able to create multiple workers at once", async () => {
    const fetchProcess2 = jest.fn().mockImplementation(
      async (): Promise<TokensResultObject> => ({
        github: "abc2",
        npm: "xyz2",
      })
    );
    const fetchProcess3 = jest.fn().mockImplementation(
      async (): Promise<TokensResultObject> => ({
        github: "abc3",
        npm: "xyz3",
      })
    );

    const worker2 = levelTwo.createSingleKeyWorker<TokensResultObject>(
      "tokens2",
      fetchProcess2
    );
    const worker3 = levelTwo.createSingleKeyWorker<TokensResultObject>(
      "tokens3",
      fetchProcess3
    );

    expect(await worker.get()).toEqual({ github: "abc123", npm: "xyz456" });
    expect(await worker2.get()).toEqual({ github: "abc2", npm: "xyz2" });
    expect(await worker3.get()).toEqual({ github: "abc3", npm: "xyz3" });
    expect(fetchProcess).toHaveBeenCalledTimes(1);
    expect(fetchProcess2).toHaveBeenCalledTimes(1);
    expect(fetchProcess3).toHaveBeenCalledTimes(1);

    // Let entries expire, while still being used as stale
    fetchProcess
      .mockClear()
      .mockImplementation(async () => ({ github: "abc", npm: "xyz" }));
    fetchProcess2
      .mockClear()
      .mockImplementation(async () => ({ github: "abc22", npm: "xyz22" }));
    fetchProcess3
      .mockClear()
      .mockImplementation(async () => ({ github: "abc33", npm: "xyz33" }));
    await wait(100);
    expect(await worker.get()).toEqual({ github: "abc123", npm: "xyz456" });
    expect(await worker2.get()).toEqual({ github: "abc2", npm: "xyz2" });
    expect(await worker3.get()).toEqual({ github: "abc3", npm: "xyz3" });
    expect(fetchProcess).not.toHaveBeenCalled();
    expect(fetchProcess2).not.toHaveBeenCalled();
    expect(fetchProcess3).not.toHaveBeenCalled();

    // Stale entries should be re-fetched on the next background cycle
    await wait(50);
    expect(fetchProcess).toHaveBeenCalledTimes(1);
    expect(fetchProcess2).toHaveBeenCalledTimes(1);
    expect(fetchProcess3).toHaveBeenCalledTimes(1);
    expect(await worker.get()).toEqual({ github: "abc", npm: "xyz" });
    expect(await worker2.get()).toEqual({ github: "abc22", npm: "xyz22" });
    expect(await worker3.get()).toEqual({ github: "abc33", npm: "xyz33" });
  });

  test("should throw an error when trying to recreate a single key worker", () => {
    expect(() =>
      levelTwo.createSingleKeyWorker<TokensResultObject>("tokens", fetchProcess)
    ).toThrow(`LevelTwo Single Key Worker 'tokens' already exists`);
  });

  test("should throw an error if fetcher process could not be found (should never happen)", async () => {
    (worker as any).id = "foobar";
    await expect(worker.get()).rejects.toThrow(
      `Missing fetch process for single key worker 'foobar'`
    );
  });
});
