import { DEFAULT_CACHE_TTL, DistributedAction, LevelTwo } from "../src";
import {
  getMockedMessageBroker,
  getMockedRemoteCache,
  MockMessageBroker,
  MockRemoteCache,
} from "./utils";

describe("LevelTwo", () => {
  let remoteCache: MockRemoteCache;
  let messageBroker: MockMessageBroker;
  let levelTwo: LevelTwo;

  beforeEach(() => {
    remoteCache = getMockedRemoteCache();
    messageBroker = getMockedMessageBroker();
    levelTwo = new LevelTwo({ remoteCache, messageBroker });
  });

  describe("constructor", () => {
    test("should allow for no settings passed in", () => {
      const levelTwo = new LevelTwo();
      expect(levelTwo.settings).toEqual({});
    });
  });

  describe("start", () => {
    test("should trigger setup on both remote cache and messageBroker when starting", async () => {
      const emitSpy = jest.spyOn(levelTwo, "emit");

      await levelTwo.start();
      expect(messageBroker.setup).toHaveBeenCalledTimes(1);
      expect(messageBroker.setup).toHaveBeenLastCalledWith(levelTwo);
      expect(remoteCache.setup).toHaveBeenCalledTimes(1);
      expect(remoteCache.setup).toHaveBeenLastCalledWith(levelTwo);
      expect(messageBroker.subscribe).toHaveBeenCalledTimes(1);
      expect(messageBroker.subscribe).toHaveBeenLastCalledWith(
        expect.any(Function)
      );
      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(emitSpy).toHaveBeenLastCalledWith(`setup`);
    });

    test("should proxy actions to the event emitter", async () => {
      await levelTwo.start();

      const emitSpy = jest.spyOn(levelTwo, "emit");

      const action: DistributedAction<string, string> = {
        worker: "customer",
        ids: ["github"],
        action: "upsert",
      };
      await messageBroker.publish(action);
      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(emitSpy).toHaveBeenLastCalledWith(`action`, action);
    });
  });

  describe("stop", () => {
    test("should trigger teardown on both remote cache and messageBroker when stopping", async () => {
      const emitSpy = jest.spyOn(levelTwo, "emit");

      await levelTwo.stop();
      expect(messageBroker.teardown).toHaveBeenCalledTimes(1);
      expect(messageBroker.teardown).toHaveBeenLastCalledWith(levelTwo);
      expect(remoteCache.teardown).toHaveBeenCalledTimes(1);
      expect(remoteCache.teardown).toHaveBeenLastCalledWith(levelTwo);
      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(emitSpy).toHaveBeenLastCalledWith(`teardown`);
    });
  });

  describe("createWorker", () => {
    afterEach(async () => {
      await levelTwo.stop();
    });

    test("should generate a worker with default parameters", () => {
      const worker = levelTwo.createWorker("customer", async () => undefined);
      expect(worker.listenerCount("error")).toStrictEqual(1);
      expect(worker.ttl).toStrictEqual(DEFAULT_CACHE_TTL);
      expect(worker.minimumRequestsForCache).toStrictEqual(0);
      expect(worker.minimumRequestsTimeThreshold).toStrictEqual(
        DEFAULT_CACHE_TTL
      );
      expect(worker.maximumCacheKeys).toStrictEqual(0);
      expect(worker.ignoreCacheFetchErrors).toStrictEqual(false);
    });

    test("should generate a worker with custom settings passed in", () => {
      const worker = levelTwo.createWorker({
        name: "customer",
        worker: async () => undefined,
        ttl: 15,
        minimumRequestsForCache: 25,
        minimumRequestsTimeThreshold: 3600,
        maximumCacheKeys: 10,
        ignoreCacheFetchErrors: true,
      });
      expect(worker.listenerCount("error")).toStrictEqual(1);
      expect(worker.ttl).toStrictEqual(15);
      expect(worker.minimumRequestsForCache).toStrictEqual(25);
      expect(worker.minimumRequestsTimeThreshold).toStrictEqual(3600);
      expect(worker.maximumCacheKeys).toStrictEqual(10);
      expect(worker.ignoreCacheFetchErrors).toStrictEqual(true);
    });

    test("should propogate exceptions from worker to levelTwo emitter", () => {
      const worker = levelTwo.createWorker("customer", async () => undefined);
      levelTwo.on("error", () => undefined);
      jest.spyOn(levelTwo, "emit");

      const error = new Error(`Mock Worker Raised Exception`);
      worker.emit("error", error);
      expect(levelTwo.emit).toHaveBeenCalledTimes(1);
      expect(levelTwo.emit).toHaveBeenCalledWith("error", error);
    });

    test("should not propogate exceptions if custom error handler is already applied to the worker", () => {
      const worker = levelTwo.createWorker("customer", async () => undefined);
      levelTwo.on("error", () => undefined);
      jest.spyOn(levelTwo, "emit");

      const error = new Error(`Mock Worker Raised Exception`);
      worker.on("error", () => undefined);
      worker.emit("error", error);
      expect(levelTwo.emit).not.toHaveBeenCalled();
    });

    test("should throw an error if a worker with the same name has already been created", async () => {
      levelTwo.createWorker("customer", async () => undefined);
      expect(() =>
        levelTwo.createWorker("customer", async () => undefined)
      ).toThrow(`LevelTwo Worker 'customer' already exists`);
    });

    test("should throw an error if no worker is defined", async () => {
      expect(() => levelTwo.createWorker("customer", {} as any)).toThrow(
        `Worker function not found`
      );
    });
  });
});
