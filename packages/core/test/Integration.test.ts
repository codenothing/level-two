import { DEFAULT_CACHE_TTL, LevelTwo } from "../src";
import { MockDataStore } from "./utils/MockDataStore";
import {
  getMockedMessageBroker,
  getMockedRemoteCache,
  MockMessageBroker,
  MockRemoteCache,
} from "./utils/";

describe("Integration", () => {
  let remoteCache: MockRemoteCache;
  let messageBroker: MockMessageBroker;
  let levelTwo: LevelTwo;
  let dataStore: MockDataStore;

  beforeEach(async () => {
    // Start the level two instance
    messageBroker = getMockedMessageBroker();
    remoteCache = getMockedRemoteCache();
    levelTwo = new LevelTwo({ messageBroker: messageBroker, remoteCache });
    await levelTwo.start();

    // Mock out data store entries
    dataStore = new MockDataStore(levelTwo);
  });

  afterEach(async () => {
    await levelTwo.stop();
  });

  test("should fetch data only once for each id", async () => {
    expect(await dataStore.customerWorker.get("github")).toEqual({
      id: "github",
      name: "Github",
    });
    expect(dataStore.customerFetch).toHaveBeenCalledTimes(1);
    expect(dataStore.customerFetch).toHaveBeenLastCalledWith(
      ["github"],
      expect.any(Function)
    );
    expect(remoteCache.get).toHaveBeenCalledTimes(1);
    expect(remoteCache.get).toHaveBeenLastCalledWith(
      "customer",
      ["github"],
      expect.any(Function)
    );

    // 'github' should have been cached localy, removing need to fetch externally
    dataStore.customerFetch.mockClear();
    (remoteCache.get as jest.Mock).mockClear();
    expect(await dataStore.customerWorker.get("github")).toEqual({
      id: "github",
      name: "Github",
    });
    expect(dataStore.customerFetch).not.toHaveBeenCalled();
    expect(remoteCache.get).not.toHaveBeenCalled();

    // Fetch on the separate animal worker with streamed responses
    expect(await dataStore.productWorker.get("laptop")).toEqual({
      id: "laptop",
      name: "Laptop",
    });
    expect(dataStore.productFetch).toHaveBeenCalledTimes(1);
    expect(dataStore.productFetch).toHaveBeenLastCalledWith(
      ["laptop"],
      expect.any(Function)
    );

    // 'laptop' should have been cached localy, removing need to fetch externally
    dataStore.productFetch.mockClear();
    expect(await dataStore.productWorker.get("laptop")).toEqual({
      id: "laptop",
      name: "Laptop",
    });
    expect(dataStore.productFetch).not.toHaveBeenCalled();
  });

  test("should parallize batch fetching calls and not duplicate fetching of ids", async () => {
    const promise1 = dataStore.customerWorker.getMulti([
      `github`,
      `circleci`,
      `npm`,
      "circleci",
    ]);
    const promise2 = dataStore.customerWorker.getMulti([
      `npm`,
      `circleci`,
      `jetbrains`,
      `npm`,
    ]);

    const [run1, run2] = await Promise.all([promise1, promise2]);
    expect(run1).toEqual([
      { id: "github", name: "Github" },
      { id: "circleci", name: "CircleCI" },
      { id: "npm", name: "NPM" },
      { id: "circleci", name: "CircleCI" },
    ]);
    expect(run2).toEqual([
      { id: "npm", name: "NPM" },
      { id: "circleci", name: "CircleCI" },
      { id: "jetbrains", name: "JetBrains" },
      { id: "npm", name: "NPM" },
    ]);

    expect(dataStore.customerFetch).toHaveBeenCalledTimes(2);
    expect(dataStore.customerFetch.mock.calls).toEqual([
      [[`github`, `circleci`, `npm`], expect.any(Function)],
      // Second call should not have overlapping ids from the first call
      [[`jetbrains`], expect.any(Function)],
    ]);
  });

  test("should allow undefined for missing data", async () => {
    expect(await dataStore.customerWorker.get(`foobar`)).toBeUndefined();
    expect(
      await dataStore.customerWorker.getMulti([`foo`, `github`, `bar`])
    ).toEqual([undefined, { id: "github", name: "Github" }, undefined]);
  });

  test("should throw exceptions for single fetch, and proxy errors for batch fetches", async () => {
    (messageBroker.publish as jest.Mock).mockResolvedValue(undefined);
    dataStore.throwErrors = true;
    await expect(dataStore.customerWorker.get(`github`)).rejects.toThrow(
      `Invalid customer fetch`
    );

    const [github, circleci] = await dataStore.customerWorker.getMulti([
      `github`,
      `circleci`,
    ]);
    expect(github).toBeInstanceOf(Error);
    expect((github as Error).message).toEqual(`Invalid customer fetch`);
    expect(github === circleci).toBeTruthy();
  });

  test("should put cache entity into both local and remote when writing a new entry", async () => {
    (messageBroker.publish as jest.Mock).mockResolvedValue(undefined);
    await dataStore.customerWorker.set(`github`, {
      id: "github",
      name: "Github",
    });
    expect(remoteCache.set).toHaveBeenCalledTimes(1);
    expect(remoteCache.set).toHaveBeenLastCalledWith("customer", [
      {
        id: "github",
        value: { id: "github", name: "Github" },
        ttl: DEFAULT_CACHE_TTL,
      },
    ]);
    expect(messageBroker.publish).toHaveBeenCalledTimes(1);
    expect(messageBroker.publish).toHaveBeenLastCalledWith({
      action: "upsert",
      worker: "customer",
      ids: ["github"],
      ttls: [DEFAULT_CACHE_TTL],
    });

    // Should fetch from local cache once entry is set
    expect(await dataStore.customerWorker.get(`github`)).toEqual({
      id: "github",
      name: "Github",
    });
    expect(dataStore.customerFetch).not.toHaveBeenCalled();
    expect(remoteCache.get).not.toHaveBeenCalled();
  });

  test("should remove entity from both local and remote cache when deleting", async () => {
    (messageBroker.publish as jest.Mock).mockResolvedValue(undefined);
    await dataStore.customerWorker.set(`github`, {
      id: "github",
      name: "Github",
    });
    expect(await dataStore.customerWorker.get(`github`)).toEqual({
      id: "github",
      name: "Github",
    });
    expect(dataStore.customerFetch).not.toHaveBeenCalled();
    expect(remoteCache.get).not.toHaveBeenCalled();

    // Deleting entry should force worker fetch process to run
    await dataStore.customerWorker.delete(`github`);
    expect(await dataStore.customerWorker.get(`github`)).toEqual({
      id: "github",
      name: "Github",
    });
    expect(dataStore.customerFetch).toHaveBeenCalledTimes(1);
    expect(remoteCache.get).toHaveBeenCalledTimes(1);
  });
});
