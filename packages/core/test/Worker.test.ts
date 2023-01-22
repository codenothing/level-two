import { LevelTwo, Worker } from "../src";
import {
  getMockedMessageBroker,
  getMockedRemoteCache,
  MockMessageBroker,
  MockRemoteCache,
  MockResultObject,
  MockDataStore,
  wait,
} from "./utils/";

describe("Worker", () => {
  let levelTwo: LevelTwo;
  let messageBroker: MockMessageBroker;
  let remoteCache: MockRemoteCache;
  let dataStore: MockDataStore;
  let worker: Worker<MockResultObject, string>;

  // Shortcut for prefilling
  function prefillWorker(
    customerWorker?: Worker<MockResultObject, string> | null,
    ids?: string[]
  ) {
    const names: Record<string, string> = {
      github: "Github",
      npm: "NPM",
      circleci: "CircleCI",
      jetbrains: "JetBrains",
    };

    ids ||= Object.keys(names);

    const values = ids.map((id) => ({
      id,
      value: { id, name: names[id] || id.toUpperCase() },
    }));

    if (customerWorker) {
      customerWorker.prefill(values);
    } else if (worker) {
      worker.prefill(values);
    }
  }

  beforeEach(async () => {
    messageBroker = getMockedMessageBroker();
    remoteCache = getMockedRemoteCache();
    levelTwo = new LevelTwo({ messageBroker, remoteCache });
    await levelTwo.start();

    dataStore = new MockDataStore(levelTwo);
    worker = new Worker(levelTwo, {
      name: "customer",
      worker: dataStore.customerFetch,
      ignoreCacheFetchErrors: true,
    });
  });

  afterEach(async () => {
    await levelTwo.stop();
  });

  describe("constructor", () => {
    test("should show worker settings overrides levelTwo settings", async () => {
      const levelTwo = new LevelTwo({
        messageBroker,
        remoteCache,
        cacheDefaults: {
          ttl: 65,
          minimumRequestsForCache: 10,
          maximumCacheKeys: 60,
          ignoreCacheFetchErrors: true,
        },
      });
      await levelTwo.start();

      jest.spyOn(levelTwo, "on");

      worker = new Worker(levelTwo, {
        name: "customer",
        worker: dataStore.customerFetch,
        maximumCacheKeys: 35,
        ignoreCacheFetchErrors: false,
      });
      expect(worker.name).toStrictEqual("customer");
      expect(worker.ttl).toStrictEqual(65);
      expect(worker.minimumRequestsForCache).toStrictEqual(10);
      expect(worker.minimumRequestsTimeThreshold).toStrictEqual(65);
      expect(worker.maximumCacheKeys).toStrictEqual(35);
      expect(worker.ignoreCacheFetchErrors).toStrictEqual(false);
      expect((levelTwo.on as jest.Mock).mock.calls).toEqual([
        ["action", expect.any(Function)],
        ["teardown", expect.any(Function)],
      ]);

      await levelTwo.stop();
    });
  });

  describe("get", () => {
    test("should proxy directly to the getMulti service", async () => {
      const batchSpy = jest
        .spyOn(worker, "getMulti")
        .mockResolvedValue([{ id: "github", name: "Github" }]);

      expect(await worker.get(`github`)).toEqual({
        id: "github",
        name: "Github",
      });
      expect(batchSpy).toHaveBeenCalledTimes(1);
      expect(batchSpy).toHaveBeenLastCalledWith(["github"]);
    });

    test("should throw any error returned, as it is just getting a single source", async () => {
      jest
        .spyOn(worker, "getMulti")
        .mockResolvedValue([new Error(`Foobar Error`)]);

      await expect(worker.get("github")).rejects.toThrow(`Foobar Error`);
    });
  });

  describe("getMulti", () => {
    test("should request multiple identifiers at the same time", async () => {
      expect(await worker.getMulti([`github`, `circleci`, `npm`])).toEqual([
        { id: "github", name: "Github" },
        { id: "circleci", name: "CircleCI" },
        { id: "npm", name: "NPM" },
      ]);
      expect(remoteCache.get).toHaveBeenCalledTimes(1);
      expect(remoteCache.get).toHaveBeenLastCalledWith(
        `customer`,
        [`github`, `circleci`, `npm`],
        expect.any(Function)
      );
      expect(dataStore.customerFetch).toHaveBeenCalledTimes(1);
      expect(dataStore.customerFetch).toHaveBeenLastCalledWith(
        [`github`, `circleci`, `npm`],
        expect.any(Function)
      );
    });

    test("should only allow one active request per id", async () => {
      expect(
        await Promise.all([
          worker.getMulti([`github`, `circleci`, `npm`]),
          worker.getMulti([`circleci`, `npm`, `jetbrains`]),
        ])
      ).toEqual([
        [
          { id: "github", name: "Github" },
          { id: "circleci", name: "CircleCI" },
          { id: "npm", name: "NPM" },
        ],
        [
          { id: "circleci", name: "CircleCI" },
          { id: "npm", name: "NPM" },
          { id: "jetbrains", name: "JetBrains" },
        ],
      ]);
      expect(remoteCache.get).toHaveBeenCalledTimes(2);
      expect((remoteCache.get as jest.Mock).mock.calls).toEqual([
        [`customer`, [`github`, `circleci`, `npm`], expect.any(Function)],
        [`customer`, [`jetbrains`], expect.any(Function)],
      ]);
      expect(dataStore.customerFetch).toHaveBeenCalledTimes(2);
      expect(dataStore.customerFetch.mock.calls).toEqual([
        [[`github`, `circleci`, `npm`], expect.any(Function)],
        [[`jetbrains`], expect.any(Function)],
      ]);
    });

    test("should send cache miss & errors to fetcher, while cache hit is returned", async () => {
      jest
        .spyOn(remoteCache, "get")
        .mockImplementation(async (_worker, _ids, earlyWrite) => {
          earlyWrite(`github`, undefined);
          earlyWrite(`circleci`, new Error(`Mock Error`));
          earlyWrite(`npm`, { id: "npm", name: "NPM" });
        });

      expect(await worker.getMulti([`github`, `circleci`, `npm`])).toEqual([
        { id: "github", name: "Github" },
        { id: "circleci", name: "CircleCI" },
        { id: "npm", name: "NPM" },
      ]);
      expect(remoteCache.get).toHaveBeenCalledTimes(1);

      // Should only send cache miss and cache error to the fetcher process
      expect(dataStore.customerFetch).toHaveBeenCalledTimes(1);
      expect(dataStore.customerFetch).toHaveBeenLastCalledWith(
        [`github`, `circleci`],
        expect.any(Function)
      );
    });

    test("should return locally cached entries without going through remoteCache or fetcher", async () => {
      expect(await worker.get(`github`)).toEqual({
        id: "github",
        name: "Github",
      });
      expect(remoteCache.get).toHaveBeenCalledTimes(1);
      expect(dataStore.customerFetch).toHaveBeenCalledTimes(1);
      expect(worker.has(`github`)).toStrictEqual(true);

      (remoteCache.get as jest.Mock).mockClear();
      dataStore.customerFetch.mockClear();
      expect(await worker.getMulti([`github`, `circleci`, `npm`])).toEqual([
        { id: "github", name: "Github" },
        { id: "circleci", name: "CircleCI" },
        { id: "npm", name: "NPM" },
      ]);
      expect(remoteCache.get).toHaveBeenCalledTimes(1);
      expect(remoteCache.get).toHaveBeenLastCalledWith(
        `customer`,
        [`circleci`, `npm`],
        expect.any(Function)
      );
      expect(dataStore.customerFetch).toHaveBeenCalledTimes(1);
      expect(dataStore.customerFetch).toHaveBeenLastCalledWith(
        [`circleci`, `npm`],
        expect.any(Function)
      );
    });

    describe("localCache", () => {
      // Make cache fetching instant
      beforeEach(() => {
        jest
          .spyOn(remoteCache, "get")
          .mockResolvedValue([{ id: "github", name: "Github" }]);
      });

      test("should immediately cache entries when they are fetched", async () => {
        const worker = new Worker<MockResultObject, string>(levelTwo, {
          name: "customer",
          worker: dataStore.customerFetch,
          ttl: 30,
        });

        // Confirm fetching fills the cache
        expect(worker.has("github")).toStrictEqual(false);
        expect(await worker.getMulti([`github`])).toEqual([
          { id: "github", name: "Github" },
        ]);
        expect(remoteCache.get).toHaveBeenCalledTimes(1);
        expect(worker.has("github")).toStrictEqual(true);

        // Confirm cache entry is used without reaching out externally
        (remoteCache.get as jest.Mock).mockClear();
        expect(await worker.getMulti([`github`])).toEqual([
          { id: "github", name: "Github" },
        ]);
        expect(remoteCache.get).not.toHaveBeenCalled();

        // Confirm cache entries are evicted once they expire
        await wait(40);
        expect(worker.has("github")).toStrictEqual(false);
        expect(await worker.getMulti([`github`])).toEqual([
          { id: "github", name: "Github" },
        ]);
        expect(remoteCache.get).toHaveBeenCalledTimes(1);
        expect(worker.has("github")).toStrictEqual(true);
      });

      test("should respect ttlLocal over ttl setting", async () => {
        const worker = new Worker<MockResultObject, string>(levelTwo, {
          name: "customer",
          worker: dataStore.customerFetch,
          ttl: 1000,
          ttlLocal: 30,
        });

        // Confirm fetching fills the cache
        expect(worker.has("github")).toStrictEqual(false);
        expect(await worker.getMulti([`github`])).toEqual([
          { id: "github", name: "Github" },
        ]);
        expect(remoteCache.get).toHaveBeenCalledTimes(1);
        expect(worker.has("github")).toStrictEqual(true);

        // Confirm entry is evicted after ttlLocal timeout
        await wait(40);
        expect(worker.has("github")).toStrictEqual(false);
      });

      test("should wait to cache entries until the minimum cache requests is hit", async () => {
        const worker = new Worker<MockResultObject, string>(levelTwo, {
          name: "customer",
          worker: dataStore.customerFetch,
          minimumRequestsForCache: 3,
        });

        // First two fetches should reach out to remote cache
        expect(await worker.getMulti([`github`, `github`])).toEqual([
          { id: "github", name: "Github" },
          { id: "github", name: "Github" },
        ]);
        expect(worker.has("github")).toStrictEqual(false);

        // Third fetch should result in the entry being cached
        expect(await worker.getMulti([`github`])).toEqual([
          { id: "github", name: "Github" },
        ]);
        expect(worker.has("github")).toStrictEqual(true);
      });

      test("should not use local cache until min requests within specified time period", async () => {
        const worker = new Worker<MockResultObject, string>(levelTwo, {
          name: "customer",
          worker: dataStore.customerFetch,
          ttl: 120,
          minimumRequestsForCache: 3,
          minimumRequestsTimeThreshold: 30,
        });

        // First two fetches should reach out to remote cache
        expect(await worker.getMulti([`github`, `github`])).toEqual([
          { id: "github", name: "Github" },
          { id: "github", name: "Github" },
        ]);
        expect(worker.has("github")).toStrictEqual(false);

        // Third and fourth should still reach out to remote cache
        await wait(35);
        expect(await worker.getMulti([`github`, `github`])).toEqual([
          { id: "github", name: "Github" },
          { id: "github", name: "Github" },
        ]);
        expect(worker.has("github")).toStrictEqual(false);

        // Fifth and sixth will again reach out as the first two are not within time threshold
        // but the result should have been cached
        expect(await worker.getMulti([`github`, `github`])).toEqual([
          { id: "github", name: "Github" },
          { id: "github", name: "Github" },
        ]);
        expect(worker.has("github")).toStrictEqual(true);
      });

      test("should not use expired cache entries", async () => {
        const worker = new Worker<MockResultObject, string>(levelTwo, {
          name: "customer",
          worker: dataStore.customerFetch,
          ttl: 1000,
          minimumRequestsForCache: 3,
        });

        (worker as any).ttl = 30;
        (worker as any).ttlLocal = 30;
        jest.spyOn(worker, "emit");

        // First fetch should reach out to remote cache
        expect(
          await worker.getMulti([`github`, `github`, `github`, `github`])
        ).toEqual([
          { id: "github", name: "Github" },
          { id: "github", name: "Github" },
          { id: "github", name: "Github" },
          { id: "github", name: "Github" },
        ]);
        expect(remoteCache.get).toHaveBeenCalledTimes(1);

        // Calling immediately after should show entry as locally cached
        (remoteCache.get as jest.Mock).mockClear();
        expect(await worker.getMulti([`github`])).toEqual([
          { id: "github", name: "Github" },
        ]);
        expect(remoteCache.get).not.toHaveBeenCalled();

        // Should not use local cache entry if it's expired
        (remoteCache.get as jest.Mock).mockClear();
        (worker.emit as jest.Mock).mockClear();
        await wait(50);
        expect(
          await worker.getMulti([`github`, `github`, `github`, `github`])
        ).toEqual([
          { id: "github", name: "Github" },
          { id: "github", name: "Github" },
          { id: "github", name: "Github" },
          { id: "github", name: "Github" },
        ]);
        expect((worker.emit as jest.Mock).mock.calls).toEqual([
          ["evict", "github"],
          ["upsert", "github", { id: "github", name: "Github" }, 30],
        ]);
        expect(remoteCache.get).toHaveBeenCalledTimes(1);

        // Fetching immediatly after expired cache is refilled should use local cache again
        (remoteCache.get as jest.Mock).mockClear();
        expect(await worker.getMulti([`github`])).toEqual([
          { id: "github", name: "Github" },
        ]);
        expect(remoteCache.get).not.toHaveBeenCalled();
      });

      test("should return cached entries for stale data, while triggering a background fetch", async () => {
        const worker = new Worker<MockResultObject, string>(levelTwo, {
          name: "customer",
          worker: dataStore.customerFetch,
          ttl: 25,
          staleCacheThreshold: 1000,
        });

        prefillWorker(worker);

        // Wait for ttl to expire, but still be within stale threshold
        await wait(50);

        // Confirm immediate cache is returned on the first call
        (remoteCache.get as jest.Mock).mockResolvedValue([
          { id: "github", name: "Github 2000" },
        ]);
        expect(await worker.getMulti([`github`])).toEqual([
          { id: "github", name: "Github" },
        ]);
        expect(remoteCache.get).toHaveBeenCalledTimes(1);

        // Confirm second call returns the updated cache value
        (remoteCache.get as jest.Mock).mockClear();
        expect(await worker.getMulti([`github`])).toEqual([
          { id: "github", name: "Github 2000" },
        ]);
        expect(remoteCache.get).not.toHaveBeenCalled();
      });

      test("should emit any stale cache exceptions instead of throwing", async () => {
        let error: Error | undefined;

        const worker = new Worker<MockResultObject, string>(levelTwo, {
          name: "customer",
          worker: dataStore.customerFetch,
          ttl: 25,
          staleCacheThreshold: 1000,
        });
        worker.on("error", (e) => (error = e));

        // Prefill local cache
        prefillWorker(worker);

        // Wait till after ttl expiration before mocking exception for throwing
        await wait(50);
        jest
          .spyOn((worker as any).burstValve, "batch")
          .mockRejectedValue(new Error(`Mock Batch Error`));

        expect(await worker.getMulti([`github`])).toEqual([
          { id: "github", name: "Github" },
        ]);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toEqual(
          `Error during stale cache background fetch for ids "github"`
        );
        expect((error as Error).cause).toBeInstanceOf(Error);
        expect(((error as Error).cause as Error).message).toEqual(
          `Mock Batch Error`
        );
      });

      test("should emit any stale cache exceptions when cache entries are split instead of throwing", async () => {
        let error: Error | undefined;
        const worker = new Worker<MockResultObject, string>(levelTwo, {
          name: "customer",
          worker: dataStore.customerFetch,
          ttl: 25,
          staleCacheThreshold: 1000,
        });

        worker.on("error", (e) => (error = e));

        // Prefill local cache
        prefillWorker(worker, ["github"]);

        // Wait till after ttl expiration before mocking exception for throwing
        await wait(50);
        jest
          .spyOn((worker as any).burstValve, "batch")
          .mockImplementation(async (ids: any) => {
            if (ids[0] === "npm") {
              return [{ id: "npm", name: "NPM" }];
            }

            throw new Error(`Mock Batch Error`);
          });

        expect(await worker.getMulti([`github`, `npm`])).toEqual([
          { id: "github", name: "Github" },
          { id: "npm", name: "NPM" },
        ]);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toEqual(
          `Error during stale cache background fetch for ids "github"`
        );
        expect((error as Error).cause).toBeInstanceOf(Error);
        expect(((error as Error).cause as Error).message).toEqual(
          `Mock Batch Error`
        );
      });
    });

    describe("prune", () => {
      beforeEach(() => {
        jest
          .spyOn(remoteCache, "get")
          .mockImplementation(async (worker, ids, earlyWrite) => {
            ids.forEach((id) => {
              earlyWrite(id, dataStore.data[`${worker}:${id}`]);
            });
          });
      });

      test("should remove expired entries", async () => {
        const worker = new Worker<MockResultObject, string>(levelTwo, {
          name: "customer",
          worker: dataStore.customerFetch,
          ttl: 10,
        });

        prefillWorker(worker);

        jest.spyOn(worker, "emit");

        // Wait for the ttl to expire to confirm cache entries are removed
        await wait(20);
        worker.prune();
        expect(worker.has("github")).toStrictEqual(false);
        expect(worker.has("npm")).toStrictEqual(false);
        expect(worker.has("circleci")).toStrictEqual(false);
        expect(worker.has("jetbrains")).toStrictEqual(false);
        expect((worker.emit as jest.Mock).mock.calls).toEqual([
          ["evict", "github"],
          ["evict", "npm"],
          ["evict", "circleci"],
          ["evict", "jetbrains"],
        ]);
      });

      test("should trim down cache", async () => {
        const worker = new Worker<MockResultObject, string>(levelTwo, {
          name: "customer",
          worker: dataStore.customerFetch,
          ttl: 1000,
        });

        prefillWorker(worker, [`github`, `circleci`, `npm`, `jetbrains`]);

        jest.spyOn(worker, "emit");

        // Override max cache size and run prune to evict entries beyond max cache keys
        (worker as any).maximumCacheKeys = 2;
        worker.prune();
        expect(worker.has("github")).toStrictEqual(false);
        expect(worker.has("circleci")).toStrictEqual(false);
        expect(worker.has("npm")).toStrictEqual(true);
        expect(worker.has("jetbrains")).toStrictEqual(true);
        expect((worker.emit as jest.Mock).mock.calls).toEqual([
          ["evict", "github"],
          ["evict", "circleci"],
        ]);
      });

      test("should trim down cache requests that exceed the time threshold", async () => {
        const worker = new Worker<MockResultObject, string>(levelTwo, {
          name: "customer",
          worker: dataStore.customerFetch,
          ttl: 30,
          minimumRequestsForCache: 4,
        });

        await worker.getMulti([`github`, `circleci`, `npm`]);
        expect(worker.has("github")).toStrictEqual(false);
        expect(worker.has("circleci")).toStrictEqual(false);
        expect(worker.has("npm")).toStrictEqual(false);

        // Add secondary requests for circleci and npm
        await wait(10);
        await worker.getMulti([`circleci`, `npm`]);
        expect(worker.has("github")).toStrictEqual(false);
        expect(worker.has("circleci")).toStrictEqual(false);
        expect(worker.has("npm")).toStrictEqual(false);

        // Add final third request for npm
        (remoteCache.get as jest.Mock).mockClear();
        await wait(10);
        await worker.getMulti([`npm`]);
        expect(worker.has("github")).toStrictEqual(false);
        expect(worker.has("circleci")).toStrictEqual(false);
        expect(worker.has("npm")).toStrictEqual(false);

        // Run GC after ttl threshold is hit to confirm old request entries are removed
        await wait(11);
        worker.prune();

        // Even request counts out to three a piece
        (remoteCache.get as jest.Mock).mockClear();
        await worker.getMulti([
          `github`,
          `github`,
          `github`,
          `circleci`,
          `circleci`,
          `npm`,
        ]);
        expect(worker.has("github")).toStrictEqual(false);
        expect(worker.has("circleci")).toStrictEqual(false);
        expect(worker.has("npm")).toStrictEqual(false);

        // Verify a final fourth request triggers caching for each entry
        (remoteCache.get as jest.Mock).mockClear();
        await worker.getMulti([`github`, `circleci`, `npm`]);
        expect(worker.has("github")).toStrictEqual(true);
        expect(worker.has("circleci")).toStrictEqual(true);
        expect(worker.has("npm")).toStrictEqual(true);
      });
    });

    describe("remoteCache", () => {
      test("should send all ids to fetch process when remote cache is missing", async () => {
        (levelTwo as any).remoteCache = undefined;
        expect(await worker.getMulti([`github`, `circleci`, `npm`])).toEqual([
          { id: "github", name: "Github" },
          { id: "circleci", name: "CircleCI" },
          { id: "npm", name: "NPM" },
        ]);
        expect(remoteCache.get).not.toHaveBeenCalled();
        expect(dataStore.customerFetch).toHaveBeenCalledTimes(1);
        expect(dataStore.customerFetch).toHaveBeenLastCalledWith(
          [`github`, `circleci`, `npm`],
          expect.any(Function)
        );
      });

      test("should handle map of results from get method", async () => {
        jest.spyOn(remoteCache, "get").mockResolvedValue(
          new Map<string, MockResultObject>([
            [`github`, { id: "github", name: "Github" }],
            [`circleci`, { id: "circleci", name: "CircleCI" }],
          ])
        );
        expect(await worker.getMulti([`github`, `circleci`])).toEqual([
          { id: "github", name: "Github" },
          { id: "circleci", name: "CircleCI" },
        ]);
        expect(remoteCache.get).toHaveBeenCalledTimes(1);
      });

      test("should handle array of results from get method", async () => {
        jest.spyOn(remoteCache, "get").mockResolvedValue([
          { id: "github", name: "Github" },
          { id: "circleci", name: "CircleCI" },
        ]);
        expect(await worker.getMulti([`github`, `circleci`])).toEqual([
          { id: "github", name: "Github" },
          { id: "circleci", name: "CircleCI" },
        ]);
        expect(remoteCache.get).toHaveBeenCalledTimes(1);
      });

      test("should return errors when array of results does not match list of ids", async () => {
        jest
          .spyOn(remoteCache, "get")
          .mockResolvedValue([{ id: "github", name: "Github" }]);

        (worker as any).ignoreCacheFetchErrors = false;
        const [error1, error2] = await worker.getMulti([`github`, `circleci`]);
        expect(error1).toBeInstanceOf(Error);
        expect((error1 as Error).message).toStrictEqual(
          `Remote cache fetch returned inconsistent result length with fetch ids requested`
        );
        expect(error1 === error2).toBeTruthy();
      });

      test("should throw an error when attempting to earlyWrite after remote cache fetch has already completed", async () => {
        return new Promise<void>((resolve, reject) => {
          jest
            .spyOn(remoteCache, "get")
            .mockImplementation(async (_worker, _ids, earlyWrite) => {
              return new Promise<void>((getResolve) => {
                getResolve();
                wait().then(async () => {
                  try {
                    await expect(
                      earlyWrite(`github`, { id: `github`, name: `Github` })
                    ).rejects.toThrow(`Cache fetching already completed`);
                    resolve();
                  } catch (e) {
                    reject(e);
                  }
                });
              });
            });

          worker.getMulti([`github`]);
        });
      });

      test("should ignore any cache thrown errors when configured to", async () => {
        jest
          .spyOn(remoteCache, "get")
          .mockRejectedValue(new Error(`Mock Remote Cache Error`));

        expect(await worker.getMulti([`github`, `circleci`])).toEqual([
          { id: "github", name: "Github" },
          { id: "circleci", name: "CircleCI" },
        ]);
        expect(remoteCache.get).toHaveBeenCalledTimes(1);
        expect(dataStore.customerFetch).toHaveBeenCalledTimes(1);
      });

      test("should return error to each id when cache errors are not configued to be ignores", async () => {
        jest
          .spyOn(remoteCache, "get")
          .mockRejectedValue(new Error(`Mock Remote Cache Error`));

        (worker as any).ignoreCacheFetchErrors = false;
        const [error1, error2] = await worker.getMulti([`github`, `circleci`]);
        expect(error1).toBeInstanceOf(Error);
        expect((error1 as Error).message).toStrictEqual(
          `Remote cache.get error`
        );
        expect((error1 as Error).cause).toBeInstanceOf(Error);
        expect(((error1 as Error).cause as Error).message).toStrictEqual(
          `Mock Remote Cache Error`
        );
        expect(error1 === error2).toBeTruthy();

        // Cache should have been called, but worker fetch should have been skipped
        expect(remoteCache.get).toHaveBeenCalledTimes(1);
        expect(dataStore.customerFetch).not.toHaveBeenCalled();
      });

      test("should emit set exception instead of throwing", async () => {
        let error: Error | undefined;

        jest
          .spyOn(remoteCache, "set")
          .mockRejectedValue(new Error(`Mock Cache Set Error`));

        jest.spyOn(worker, "emit");

        worker.on("error", (e) => (error = e));

        // Fetching of data should still have been successful
        expect(await worker.getMulti([`github`, `circleci`])).toEqual([
          { id: "github", name: "Github" },
          { id: "circleci", name: "CircleCI" },
        ]);
        await wait();

        expect(error?.message).toStrictEqual(
          `Failed to set workers results with remoteCache`
        );
        expect(error?.cause).toBeInstanceOf(Error);
        expect((error?.cause as Error).message).toStrictEqual(
          `Mock Cache Set Error`
        );
      });
    });

    describe("worker-fetch", () => {
      test("should handle map of results", async () => {
        const worker = new Worker<MockResultObject, string>(levelTwo, {
          name: "customer",
          worker: async () => {
            return new Map<string, MockResultObject>([
              [`github`, { id: "github", name: "Worker Fetch Github" }],
              [`circleci`, { id: "circleci", name: "Worker Fetch CircleCI" }],
            ]);
          },
        });

        expect(await worker.getMulti([`github`, `circleci`])).toEqual([
          { id: "github", name: "Worker Fetch Github" },
          { id: "circleci", name: "Worker Fetch CircleCI" },
        ]);
      });

      test("should handle array of results", async () => {
        const worker = new Worker<MockResultObject, string>(levelTwo, {
          name: "customer",
          worker: async () => {
            return [
              { id: "github", name: "Worker Fetch Github" },
              { id: "circleci", name: "Worker Fetch CircleCI" },
            ];
          },
        });

        expect(await worker.getMulti([`github`, `circleci`])).toEqual([
          { id: "github", name: "Worker Fetch Github" },
          { id: "circleci", name: "Worker Fetch CircleCI" },
        ]);
      });

      test("should return errors when array of results does not match list of ids", async () => {
        const worker = new Worker<MockResultObject, string>(levelTwo, {
          name: "customer",
          worker: async () => {
            return [{ id: "github", name: "Worker Fetch Github" }];
          },
        });

        const [error1, error2] = await worker.getMulti([`github`, `circleci`]);
        expect(error1).toBeInstanceOf(Error);
        expect((error1 as Error).message).toStrictEqual(
          `Worker fetch results length does not match batch id length`
        );
        expect(error1 === error2).toBeTruthy();
      });

      test("should return fetcher exception to each id", async () => {
        const worker = new Worker<MockResultObject, string>(levelTwo, {
          name: "customer",
          worker: async () => {
            throw new Error(`Mock Fetcher Error`);
          },
        });

        const [error1, error2] = await worker.getMulti([`github`, `circleci`]);
        expect(error1).toBeInstanceOf(Error);
        expect((error1 as Error).message).toStrictEqual(
          `Worker fetch process error`
        );
        expect((error1 as Error).cause).toBeInstanceOf(Error);
        expect(((error1 as Error).cause as Error).message).toStrictEqual(
          `Mock Fetcher Error`
        );
        expect(error1 === error2).toBeTruthy();
      });

      test("should throw error when earlyWrite is triggered after fetch results have already returned", async () => {
        return new Promise<void>((resolve, reject) => {
          const worker = new Worker<MockResultObject, string>(levelTwo, {
            name: "customer",
            worker: async (_ids, earlyWrite) => {
              return new Promise<void>((workerResolve) => {
                workerResolve();
                wait().then(async () => {
                  try {
                    await expect(
                      earlyWrite(`github`, { id: "github", name: "Github" })
                    ).rejects.toThrow(
                      `Worker fetch process has already completed`
                    );
                    resolve();
                  } catch (e) {
                    reject(e);
                  }
                });
              });
            },
          });

          worker.getMulti([`github`]);
        });
      });
    });
  });

  describe("getUnsafeMulti", () => {
    test("should request multiple identifiers at the same time", async () => {
      expect(
        await worker.getUnsafeMulti([`github`, `circleci`, `npm`])
      ).toEqual([
        { id: "github", name: "Github" },
        { id: "circleci", name: "CircleCI" },
        { id: "npm", name: "NPM" },
      ]);
      expect(remoteCache.get).toHaveBeenCalledTimes(1);
      expect(remoteCache.get).toHaveBeenLastCalledWith(
        `customer`,
        [`github`, `circleci`, `npm`],
        expect.any(Function)
      );
      expect(dataStore.customerFetch).toHaveBeenCalledTimes(1);
      expect(dataStore.customerFetch).toHaveBeenLastCalledWith(
        [`github`, `circleci`, `npm`],
        expect.any(Function)
      );
    });

    test("should use cached results", async () => {
      prefillWorker(worker);
      expect(await worker.getUnsafeMulti([`github`, `npm`])).toEqual([
        { id: "github", name: "Github" },
        { id: "npm", name: "NPM" },
      ]);
      expect(remoteCache.get).not.toHaveBeenCalled();
      expect(dataStore.customerFetch).not.toHaveBeenCalled();
    });

    test("should return cached entries for stale data, while triggering a background fetch", async () => {
      const worker = new Worker<MockResultObject, string>(levelTwo, {
        name: "customer",
        worker: dataStore.customerFetch,
        ttl: 25,
        staleCacheThreshold: 1000,
      });

      prefillWorker(worker);

      // Wait for ttl to expire, but still be within stale threshold
      await wait(50);

      // Confirm immediate cache is returned on the first call
      (remoteCache.get as jest.Mock).mockResolvedValue([
        { id: "github", name: "Github 2000" },
      ]);
      expect(await worker.getUnsafeMulti([`github`])).toEqual([
        { id: "github", name: "Github" },
      ]);
      expect(remoteCache.get).toHaveBeenCalledTimes(1);

      // Confirm second call returns the updated cache value
      (remoteCache.get as jest.Mock).mockClear();
      expect(await worker.getUnsafeMulti([`github`])).toEqual([
        { id: "github", name: "Github 2000" },
      ]);
      expect(remoteCache.get).not.toHaveBeenCalled();
    });

    test("should throw fetcher errors instead of returning them", async () => {
      dataStore.customerFetch.mockRejectedValue(
        new Error(`Mock Fetcher Error`)
      );

      try {
        await worker.getUnsafeMulti([`github`, `circleci`, `npm`]);
        throw new Error("Should Not Get Here");
      } catch (e) {
        let error = e as Error;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toStrictEqual(
          `Batch fetcher error for 'customer' Worker`
        );

        error = error.cause as Error;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toStrictEqual(
          `Worker fetch process error`
        );

        error = error.cause as Error;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toStrictEqual(`Mock Fetcher Error`);
      }
    });

    test("should throw fetcher returned errors", async () => {
      dataStore.customerFetch.mockImplementation(async (ids) =>
        ids.map(() => new Error(`Mock Returned Error`))
      );

      try {
        await worker.getUnsafeMulti([`github`, `circleci`, `npm`]);
        throw new Error("Should Not Get Here");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect((e as Error).message).toStrictEqual(
          `Batch fetcher error for 'customer' Worker`
        );
        expect((e as Error).cause).toBeInstanceOf(Error);
        expect(((e as Error).cause as Error).message).toStrictEqual(
          `Mock Returned Error`
        );
      }
    });

    test("should throw remoteCache errors instead of returning them", async () => {
      const worker = new Worker<MockResultObject, string>(levelTwo, {
        name: "customer",
        worker: dataStore.customerFetch,
        ignoreCacheFetchErrors: false,
      });

      jest
        .spyOn(remoteCache, "get")
        .mockRejectedValue(new Error(`Mock Remote Cache Error`));

      try {
        await worker.getUnsafeMulti([`github`, `circleci`, `npm`]);
        throw new Error("Should Not Get Here");
      } catch (e) {
        let error = e as Error;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toStrictEqual(
          `Batch fetcher error for 'customer' Worker`
        );

        error = error.cause as Error;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toStrictEqual(
          `Remote cache.get error`
        );

        error = error.cause as Error;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toStrictEqual(
          `Mock Remote Cache Error`
        );
      }
    });

    test("should throw remoteCache returned errors", async () => {
      const worker = new Worker<MockResultObject, string>(levelTwo, {
        name: "customer",
        worker: dataStore.customerFetch,
        ignoreCacheFetchErrors: false,
      });

      jest
        .spyOn(remoteCache, "get")
        .mockImplementation(async (_worker, ids) =>
          ids.map(() => new Error(`Mock Cache Return Error`))
        );

      try {
        await worker.getUnsafeMulti([`github`, `circleci`, `npm`]);
        throw new Error("Should Not Get Here");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect((e as Error).message).toStrictEqual(
          `Batch fetcher error for 'customer' Worker`
        );
        expect((e as Error).cause).toBeInstanceOf(Error);
        expect(((e as Error).cause as Error).message).toStrictEqual(
          `Mock Cache Return Error`
        );
      }
    });
  });

  describe("stream", () => {
    let idsFetched: string[][];
    let earlyWrite: (
      subqueue: string,
      result: MockResultObject | Error | undefined
    ) => void;
    let batchResolve: () => void;

    beforeEach(() => {
      idsFetched = [];
      earlyWrite = () => undefined;
      batchResolve = () => undefined;
      worker = new Worker(levelTwo, {
        name: "customer",
        ttl: 50,
        staleCacheThreshold: 600000,
        worker: async (ids, ew) => {
          idsFetched.push(ids);
          earlyWrite = ew;
          return new Promise((resolve) => (batchResolve = resolve));
        },
      });
    });

    test("should only send batch request for uncached items", async () => {
      prefillWorker(worker, ["github", "npm"]);

      const responses: Array<{
        id: string;
        result: MockResultObject | Error | undefined;
      }> = [];
      const streamPromise = worker.stream(
        ["circleci", "github", "jetbrains", "npm", "jira"],
        async (id, result) => {
          responses.push({ id, result });
        }
      );
      await wait();
      expect(responses).toEqual([
        {
          id: "github",
          result: { id: "github", name: "Github" },
        },
        {
          id: "npm",
          result: { id: "npm", name: "NPM" },
        },
      ]);
      expect(idsFetched).toEqual([["circleci", "jetbrains", "jira"]]);

      // Should propogate found entry
      earlyWrite("circleci", { id: "circleci", name: "CircleCI" });
      await wait();
      expect(responses).toEqual([
        {
          id: "github",
          result: { id: "github", name: "Github" },
        },
        {
          id: "npm",
          result: { id: "npm", name: "NPM" },
        },
        {
          id: "circleci",
          result: { id: "circleci", name: "CircleCI" },
        },
      ]);

      // Should propogate any errors written out
      const mockError = new Error("Mock Early Write Error");
      earlyWrite("jetbrains", mockError);
      await wait();
      expect(responses).toEqual([
        {
          id: "github",
          result: { id: "github", name: "Github" },
        },
        {
          id: "npm",
          result: { id: "npm", name: "NPM" },
        },
        {
          id: "circleci",
          result: { id: "circleci", name: "CircleCI" },
        },
        {
          id: "jetbrains",
          result: mockError,
        },
      ]);

      // Should fill out undefined when worker process ends with untriggered ids
      batchResolve();
      await wait();
      expect(responses).toEqual([
        {
          id: "github",
          result: { id: "github", name: "Github" },
        },
        {
          id: "npm",
          result: { id: "npm", name: "NPM" },
        },
        {
          id: "circleci",
          result: { id: "circleci", name: "CircleCI" },
        },
        {
          id: "jetbrains",
          result: mockError,
        },
        {
          id: "jira",
          result: undefined,
        },
      ]);

      // Make sure the stream promise ends after worker and streamed callbacks complete
      await streamPromise;
    });

    test("should fire off request for stale ids when doing stream calls", async () => {
      prefillWorker(worker, ["github"]);
      await wait(60);
      prefillWorker(worker, ["npm"]);

      worker.stream(["github", "npm", "circleci"], async () => undefined);
      await wait(5);
      expect(idsFetched).toEqual([["circleci"], ["github"]]);
    });
  });

  describe("upsert", () => {
    test("should just proxy upsert request to upsertMulti", async () => {
      jest
        .spyOn(worker, "upsertMulti")
        .mockResolvedValue([{ id: "github", name: "Github" }]);

      expect(await worker.upsert("github", true)).toEqual({
        id: "github",
        name: "Github",
      });
      expect(worker.upsertMulti).toHaveBeenCalledTimes(1);
      expect(worker.upsertMulti).toHaveBeenLastCalledWith(["github"], true);
    });

    test("should throw error returned from upsertMulti", async () => {
      jest
        .spyOn(worker, "upsertMulti")
        .mockResolvedValue([new Error(`Mock Multi Upsert Error`)]);

      await expect(worker.upsert("github")).rejects.toThrow(
        `Mock Multi Upsert Error`
      );
    });
  });

  describe("upsertMulti", () => {
    test("should skip cached entries and replace with new results", async () => {
      prefillWorker();

      // Calling upsertMulti should return the new value
      (remoteCache.get as jest.Mock).mockResolvedValue([
        { id: "github", name: "Not Github" },
      ]);
      expect(await worker.upsertMulti(["github"])).toEqual([
        { id: "github", name: "Not Github" },
      ]);
      expect(remoteCache.get).toHaveBeenCalledTimes(1);
      expect(worker.has("github")).toStrictEqual(true);

      // getMulti method should use the new cached entries
      (remoteCache.get as jest.Mock).mockClear();
      expect(await worker.getMulti(["github"])).toEqual([
        { id: "github", name: "Not Github" },
      ]);
      expect(remoteCache.get).not.toHaveBeenCalled();
    });

    test("should use fetcher process directly when skipRemoteCache is enabled", async () => {
      prefillWorker();

      // Calling upsertMulti should return the new value
      (remoteCache.get as jest.Mock).mockResolvedValue([
        { id: "github", name: "Mocked Cached Github" },
      ]);
      dataStore.customerFetch.mockResolvedValue([
        { id: "github", name: "Mocked Fetched Github" },
      ]);
      expect(await worker.upsertMulti(["github"], true)).toEqual([
        { id: "github", name: "Mocked Fetched Github" },
      ]);
      expect(remoteCache.get).not.toHaveBeenCalled();
      expect(dataStore.customerFetch).toHaveBeenCalledTimes(1);
      expect(remoteCache.set).toHaveBeenCalledTimes(1);

      // Confirm getMulti method uses newly cached data
      (remoteCache.get as jest.Mock).mockClear();
      expect(await worker.getMulti(["github"])).toEqual([
        { id: "github", name: "Mocked Fetched Github" },
      ]);
      expect(remoteCache.get).not.toHaveBeenCalled();
    });
  });

  describe("set", () => {
    test("should proxy set calls to setMulti", async () => {
      jest.spyOn(worker, "setMulti").mockResolvedValue(undefined);

      await worker.set("github", { id: "github", name: "Github2" }, 300);
      expect(worker.setMulti).toHaveBeenCalledTimes(1);
      expect(worker.setMulti).toHaveBeenLastCalledWith([
        {
          id: `github`,
          ttl: 300,
          value: {
            id: `github`,
            name: `Github2`,
          },
        },
      ]);
    });
  });

  describe("setMulti", () => {
    test("should set entry into both local and remote cache before publishing a distributed action", async () => {
      jest.spyOn(messageBroker, "publish").mockResolvedValue(undefined);
      jest.spyOn(worker, "emit");

      expect(worker.has("github")).toStrictEqual(false);
      expect(worker.has("npm")).toStrictEqual(false);
      await worker.setMulti([
        { id: "github", value: { id: "github", name: "Github2" }, ttl: 1200 },
        { id: "npm", value: { id: "npm", name: "NPM2" }, ttl: 500 },
      ]);
      expect(worker.has("github")).toStrictEqual(true);
      expect(worker.has("npm")).toStrictEqual(true);
      expect((worker.emit as jest.Mock).mock.calls).toEqual([
        ["upsert", "github", { id: "github", name: "Github2" }, 1200],
        ["upsert", "npm", { id: "npm", name: "NPM2" }, 500],
      ]);
      expect(remoteCache.set).toHaveBeenCalledTimes(1);
      expect(remoteCache.set).toHaveBeenLastCalledWith(`customer`, [
        {
          id: `github`,
          ttl: 1200,
          value: {
            id: `github`,
            name: `Github2`,
          },
        },
        {
          id: `npm`,
          ttl: 500,
          value: {
            id: `npm`,
            name: `NPM2`,
          },
        },
      ]);
      expect(messageBroker.publish).toHaveBeenCalledTimes(1);
      expect(messageBroker.publish).toHaveBeenLastCalledWith({
        action: `upsert`,
        worker: `customer`,
        ids: [`github`, `npm`],
        ttls: [1200, 500],
      });
    });
  });

  describe("delete", () => {
    test("should just proxy to deleteMulti", async () => {
      jest.spyOn(worker, "deleteMulti").mockResolvedValue(undefined);

      await worker.delete("github");
      expect(worker.deleteMulti).toHaveBeenCalledTimes(1);
      expect(worker.deleteMulti).toHaveBeenLastCalledWith(["github"]);
    });
  });

  describe("deleteMulti", () => {
    test("should delete the entry from both local and remote cache before publishing a distributed action", async () => {
      jest.spyOn(messageBroker, "publish").mockResolvedValue(undefined);
      prefillWorker();
      jest.spyOn(worker, "emit");

      // Delete the entry should remove from both local and remote
      await worker.deleteMulti(["github", "npm"]);
      expect(worker.has("github")).toStrictEqual(false);
      expect(worker.has("npm")).toStrictEqual(false);
      expect((worker.emit as jest.Mock).mock.calls).toEqual([
        ["delete", "github"],
        ["delete", "npm"],
      ]);
      expect(remoteCache.delete).toHaveBeenCalledTimes(1);
      expect(remoteCache.delete).toHaveBeenLastCalledWith("customer", [
        "github",
        "npm",
      ]);
      expect(messageBroker.publish).toHaveBeenCalledTimes(1);
      expect(messageBroker.publish).toHaveBeenLastCalledWith({
        action: "delete",
        worker: "customer",
        ids: ["github", "npm"],
      });
    });
  });

  describe("touch", () => {
    test("should just proxy to touchMulti", async () => {
      jest.spyOn(worker, "touchMulti").mockResolvedValue(undefined);

      await worker.touch("github", 450);
      expect(worker.touchMulti).toHaveBeenCalledTimes(1);
      expect(worker.touchMulti).toHaveBeenLastCalledWith([
        { id: "github", ttl: 450 },
      ]);
    });
  });

  describe("touchMulti", () => {
    test("should extend local cache entries and signal to all applications to extend ttl", async () => {
      const worker = new Worker<MockResultObject, string>(levelTwo, {
        name: "customer",
        worker: dataStore.customerFetch,
        ttl: 20,
      });

      prefillWorker(worker);

      jest.spyOn(worker, "emit");

      await wait(10); // 10ms total
      await worker.touchMulti([
        { id: "github", ttl: 40 },
        { id: "npm", ttl: 60 },
      ]);
      expect(worker.has("github")).toStrictEqual(true);
      expect(worker.has("npm")).toStrictEqual(true);
      expect(remoteCache.touch).toHaveBeenCalledTimes(1);
      expect(remoteCache.touch).toHaveBeenLastCalledWith("customer", [
        { id: "github", ttl: 40 },
        { id: "npm", ttl: 60 },
      ]);
      expect(messageBroker.publish).toHaveBeenCalledTimes(1);
      expect(messageBroker.publish).toHaveBeenLastCalledWith({
        action: "touch",
        worker: "customer",
        ids: ["github", "npm"],
        ttls: [40, 60],
      });
      expect((worker.emit as jest.Mock).mock.calls).toEqual([
        ["touch", "github", 40],
        ["touch", "npm", 60],
      ]);

      // After the first ttl mark, both entries should still exist after touch
      await wait(20); // 30ms total
      worker.prune();
      expect(worker.has("github")).toStrictEqual(true);
      expect(worker.has("npm")).toStrictEqual(true);

      // After the first post touch ttl mark, only npm should still exist
      await wait(25); // 55ms total
      worker.prune();
      expect(worker.has("github")).toStrictEqual(false);
      expect(worker.has("npm")).toStrictEqual(true);

      // After the second post touch ttl mark, both should be evicted
      await wait(20); // 75ms total
      worker.prune();
      expect(worker.has("github")).toStrictEqual(false);
      expect(worker.has("npm")).toStrictEqual(false);
    });

    test("should use default ttl and handle no remote cache", async () => {
      const worker = new Worker<MockResultObject, string>(levelTwo, {
        name: "customer",
        worker: dataStore.customerFetch,
        ttl: 20,
      });

      (levelTwo as any).remoteCache = undefined;
      prefillWorker(worker);
      expect(worker.has("github")).toStrictEqual(true);
      expect(worker.has("npm")).toStrictEqual(true);

      await wait(10); // 10ms total
      await worker.touchMulti([{ id: "github" }, { id: "npm" }]);
      expect(worker.has("github")).toStrictEqual(true);
      expect(worker.has("npm")).toStrictEqual(true);

      await wait(15); // 25ms total
      worker.prune();
      expect(worker.has("github")).toStrictEqual(true);
      expect(worker.has("npm")).toStrictEqual(true);

      await wait(15); // 40ms total
      worker.prune();
      expect(worker.has("github")).toStrictEqual(false);
      expect(worker.has("npm")).toStrictEqual(false);
    });
  });

  describe("exists", () => {
    test("should proxy to existsMulti call", async () => {
      jest.spyOn(worker, "existsMulti").mockResolvedValue([true]);

      expect(await worker.exists("github", false)).toStrictEqual(true);
      expect(worker.existsMulti).toHaveBeenCalledTimes(1);
      expect(worker.existsMulti).toHaveBeenLastCalledWith(["github"], false);
    });
  });

  describe("existsMulti", () => {
    test("should check local cache first before going out to remote", async () => {
      jest.spyOn(remoteCache, "exists").mockResolvedValue([true]);
      prefillWorker(null, ["github"]);

      expect(await worker.existsMulti(["github", "npm"])).toStrictEqual([
        true,
        true,
      ]);
      expect(remoteCache.exists).toHaveBeenCalledTimes(1);
      expect(remoteCache.exists).toHaveBeenLastCalledWith("customer", ["npm"]);
    });

    test("should bypass local cache if requested", async () => {
      jest.spyOn(remoteCache, "exists").mockResolvedValue([false, true]);
      prefillWorker(null, ["github"]);

      expect(await worker.existsMulti(["github", "npm"], true)).toStrictEqual([
        false,
        true,
      ]);
      expect(remoteCache.exists).toHaveBeenCalledTimes(1);
      expect(remoteCache.exists).toHaveBeenLastCalledWith("customer", [
        "github",
        "npm",
      ]);
    });

    test("should throw error if exists results dont match request ids", async () => {
      jest.spyOn(remoteCache, "exists").mockResolvedValue([true]);

      await expect(worker.existsMulti(["github", "npm"])).rejects.toThrow(
        `Unknown return length from remote cache for exists, results length must match ids length`
      );
    });
  });

  describe("broadcast", () => {
    test("should send signal through message broker", async () => {
      expect(messageBroker.publish).not.toHaveBeenCalled();
      await worker.broadcast("upsert", ["github", "npm"]);
      expect(messageBroker.publish).toHaveBeenCalledTimes(1);
      expect(messageBroker.publish).toHaveBeenLastCalledWith({
        action: "upsert",
        worker: "customer",
        ids: ["github", "npm"],
        ttl: undefined,
      });
    });

    test("should throw an error if message broker is not configured", async () => {
      (levelTwo as any).messageBroker = undefined;
      await expect(
        worker.broadcast("upsert", ["github", "npm"])
      ).rejects.toThrow("Message broker not configured");
    });
  });

  describe("size", () => {
    test("should return number of valid keys", async () => {
      prefillWorker(null, ["github", "npm"]);
      expect(worker.size()).toStrictEqual(2);
    });
  });

  describe("has", () => {
    test("should indicate if id exists in the cache", async () => {
      expect(worker.has("github")).toStrictEqual(false);
      prefillWorker(null, ["github"]);
      expect(worker.has("github")).toStrictEqual(true);
    });

    test("should only indicate if id is still valid", async () => {
      const worker = new Worker(levelTwo, {
        name: "customer",
        worker: dataStore.customerFetch,
        ttl: 50,
      });

      await wait(10); // 10ms total
      await worker.get("github");
      expect(worker.has("github")).toStrictEqual(true);

      await wait(15); // 25ms total
      expect(worker.has("github")).toStrictEqual(true);

      await wait(40); // 65ms total
      expect(worker.has("github")).toStrictEqual(false);
    });
  });

  describe("hasMulti", () => {
    test("should indicate if list ids pas the has test", async () => {
      expect(worker.hasMulti(["github", "npm", "circleci"])).toStrictEqual([
        false,
        false,
        false,
      ]);
      prefillWorker(null, ["github", "npm"]);
      expect(worker.hasMulti(["github", "npm", "circleci"])).toStrictEqual([
        true,
        true,
        false,
      ]);
    });
  });

  describe("keys", () => {
    test("should only return list of valid ids", async () => {
      const worker = new Worker<MockResultObject, string>(levelTwo, {
        name: "customer",
        worker: dataStore.customerFetch,
        ttl: 1000,
      });

      worker.prefill([
        { id: "github", value: { id: "github", name: "Github" }, ttl: 10 },
        { id: "npm", value: { id: "npm", name: "NPM" }, ttl: 1000 },
        {
          id: "circleci",
          value: { id: "circleci", name: "CircleCI" },
          ttl: 1000,
        },
      ]);
      expect(worker.keys()).toEqual(["github", "npm", "circleci"]);

      await wait(20);
      expect(worker.keys()).toEqual(["npm", "circleci"]);
    });
  });

  describe("values", () => {
    test("should only return list of valid values", async () => {
      const worker = new Worker<MockResultObject, string>(levelTwo, {
        name: "customer",
        worker: dataStore.customerFetch,
        ttl: 1000,
      });

      worker.prefill([
        { id: "github", value: { id: "github", name: "Github" }, ttl: 10 },
        { id: "npm", value: { id: "npm", name: "NPM" }, ttl: 1000 },
        {
          id: "circleci",
          value: { id: "circleci", name: "CircleCI" },
          ttl: 1000,
        },
      ]);
      expect(worker.values()).toEqual([
        { id: "github", name: "Github" },
        { id: "npm", name: "NPM" },
        { id: "circleci", name: "CircleCI" },
      ]);

      await wait(20);
      expect(worker.values()).toEqual([
        { id: "npm", name: "NPM" },
        { id: "circleci", name: "CircleCI" },
      ]);
    });
  });

  describe("entries", () => {
    test("should only return list of valid key/value pairs", async () => {
      const worker = new Worker<MockResultObject, string>(levelTwo, {
        name: "customer",
        worker: dataStore.customerFetch,
        ttl: 1000,
      });

      worker.prefill([
        { id: "github", value: { id: "github", name: "Github" }, ttl: 10 },
        { id: "npm", value: { id: "npm", name: "NPM" }, ttl: 1000 },
        {
          id: "circleci",
          value: { id: "circleci", name: "CircleCI" },
          ttl: 1000,
        },
      ]);
      expect(worker.entries()).toEqual([
        ["github", { id: "github", name: "Github" }],
        ["npm", { id: "npm", name: "NPM" }],
        ["circleci", { id: "circleci", name: "CircleCI" }],
      ]);

      await wait(20);
      expect(worker.entries()).toEqual([
        ["npm", { id: "npm", name: "NPM" }],
        ["circleci", { id: "circleci", name: "CircleCI" }],
      ]);
    });
  });

  describe("forEach", () => {
    test("should only iterate list of valid ids", async () => {
      let ids: string[] = [];
      const worker = new Worker<MockResultObject, string>(levelTwo, {
        name: "customer",
        worker: dataStore.customerFetch,
        ttl: 1000,
      });

      worker.prefill([
        { id: "github", value: { id: "github", name: "Github" }, ttl: 10 },
        { id: "npm", value: { id: "npm", name: "NPM" }, ttl: 1000 },
        {
          id: "circleci",
          value: { id: "circleci", name: "CircleCI" },
          ttl: 1000,
        },
      ]);
      worker.forEach((_value, id) => ids.push(id));
      expect(ids).toEqual(["github", "npm", "circleci"]);

      await wait(20);
      ids = [];
      worker.forEach((_value, id) => ids.push(id));
      expect(ids).toEqual(["npm", "circleci"]);
    });
  });

  describe("prefill", () => {
    test("should add entries into the cache", () => {
      expect(worker.has("github")).toStrictEqual(false);
      expect(worker.has("npm")).toStrictEqual(false);

      worker.prefill([
        { id: "github", value: { id: "github", name: "Github" } },
        { id: "npm", value: { id: "npm", name: "NPM" } },
      ]);
      expect(worker.has("github")).toStrictEqual(true);
      expect(worker.has("npm")).toStrictEqual(true);
    });
  });

  describe("peek", () => {
    test("should only return value of identifier if it exists and is valid", async () => {
      const worker = new Worker<MockResultObject, string>(levelTwo, {
        name: "customer",
        worker: dataStore.customerFetch,
        ttl: 1000,
      });

      worker.prefill([
        { id: "github", value: { id: "github", name: "Github" }, ttl: 20 },
        { id: "npm", value: { id: "npm", name: "NPM" }, ttl: 1000 },
      ]);
      expect(worker.peek("github")).toEqual({ id: "github", name: "Github" });
      expect(worker.peek("npm")).toEqual({ id: "npm", name: "NPM" });

      await wait(30);
      expect(worker.peek("github")).toEqual(undefined);
      expect(worker.peek("npm")).toEqual({ id: "npm", name: "NPM" });
    });
  });

  describe("peekMulti", () => {
    test("should only return list of values that are in local cache", async () => {
      const worker = new Worker<MockResultObject, string>(levelTwo, {
        name: "customer",
        worker: dataStore.customerFetch,
        ttl: 1000,
      });

      worker.prefill([
        { id: "github", value: { id: "github", name: "Github" }, ttl: 10 },
        { id: "npm", value: { id: "npm", name: "NPM" }, ttl: 1000 },
        {
          id: "circleci",
          value: { id: "circleci", name: "CircleCI" },
          ttl: 1000,
        },
      ]);
      expect(worker.peekMulti(["github", "npm", "circleci"])).toEqual([
        { id: "github", name: "Github" },
        { id: "npm", name: "NPM" },
        { id: "circleci", name: "CircleCI" },
      ]);

      await wait(20);
      expect(worker.peekMulti(["github", "npm", "circleci"])).toEqual([
        undefined,
        { id: "npm", name: "NPM" },
        { id: "circleci", name: "CircleCI" },
      ]);
    });
  });

  describe("clear", () => {
    test("should clear local cache and force new fetches on the same id", async () => {
      expect(worker.has(`github`)).toStrictEqual(false);
      prefillWorker();
      expect(worker.has(`github`)).toStrictEqual(true);

      // Confirm clearing removes from cache
      worker.clear();
      expect(worker.has(`github`)).toStrictEqual(false);
    });

    test("should clear request counts", async () => {
      const worker = new Worker(levelTwo, {
        name: "customer",
        worker: dataStore.customerFetch,
        minimumRequestsForCache: 3,
      });

      await worker.getMulti([`github`, `github`]);
      expect(remoteCache.get).toHaveBeenCalledTimes(1);
      worker.clear();

      (remoteCache.get as jest.Mock).mockClear();
      await worker.getMulti([`github`, `github`, `github`, `github`]);
      expect(remoteCache.get).toHaveBeenCalledTimes(1);

      (remoteCache.get as jest.Mock).mockClear();
      await worker.getMulti([`github`]);
      expect(remoteCache.get).not.toHaveBeenCalled();
    });
  });

  describe("Symbol.iterator", () => {
    test("should only iterate list of valid ids", async () => {
      jest
        .spyOn(remoteCache, "get")
        .mockImplementation(async (_worker, ids) => {
          return ids.map((id) => ({ id, name: id }));
        });

      let ids: string[] = [];
      const worker = new Worker<MockResultObject, string>(levelTwo, {
        name: "customer",
        worker: dataStore.customerFetch,
        ttl: 1000,
      });

      worker.prefill([
        { id: "github", value: { id: "github", name: "Github" }, ttl: 10 },
        { id: "npm", value: { id: "npm", name: "NPM" }, ttl: 10000 },
        {
          id: "circleci",
          value: { id: "circleci", name: "CircleCI" },
          ttl: 10000,
        },
      ]);
      for (const [id] of worker) {
        ids.push(id);
      }
      expect(ids).toEqual(["github", "npm", "circleci"]);

      await wait(20);
      ids = [];
      for (const [id] of worker) {
        ids.push(id);
      }
      expect(ids).toEqual(["npm", "circleci"]);
    });
  });

  describe("messageBroker", () => {
    test("should remove entries from local cache when delete actions are distributed", async () => {
      prefillWorker();

      // Trigger delete action
      levelTwo.emit("action", {
        action: "delete",
        worker: "customer",
        ids: ["github"],
      });
      expect(worker.has("github")).toStrictEqual(false);
      expect(worker.has("npm")).toStrictEqual(true);
    });

    test("should update cache entries when upsert actions are distributed", async () => {
      prefillWorker();

      // Trigger delete action
      (remoteCache.get as jest.Mock).mockClear();
      levelTwo.emit("action", {
        action: "upsert",
        worker: "customer",
        ids: ["github"],
        ttls: [1200],
      });
      expect(worker.has("github")).toStrictEqual(true);
      expect(remoteCache.get).toHaveBeenCalledTimes(1);
      expect(remoteCache.get).toHaveBeenLastCalledWith(
        `customer`,
        [`github`],
        expect.any(Function)
      );
    });

    test("should emit exception when upsert key not found instead of throwing", async () => {
      let error: Error | undefined;
      worker.on("error", (e) => (error = e));
      prefillWorker();

      // Clear remote data store and cache before looking for upsert error
      (remoteCache.get as jest.Mock).mockClear();
      dataStore.data = {};
      remoteCache.cache = {};
      levelTwo.emit("action", {
        action: "upsert",
        worker: "customer",
        ids: ["github"],
      });
      expect(worker.has("github")).toStrictEqual(true);
      expect(remoteCache.get).toHaveBeenCalledTimes(1);
      expect(remoteCache.get).toHaveBeenLastCalledWith(
        `customer`,
        [`github`],
        expect.any(Function)
      );
      await wait(20);
      expect(error).toBeInstanceOf(Error);
    });
  });
});
