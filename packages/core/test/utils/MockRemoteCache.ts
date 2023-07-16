import { MockResultObject, wait } from ".";
import { CacheTouch, RemoteCache, RemoteCacheEntry } from "../../src";

interface MockCacheEntry {
  value: MockResultObject;
  expires: number;
}

export const getMockedRemoteCache = () => {
  const remoteCache = new MockRemoteCache();
  jest.spyOn(remoteCache, "setup");
  jest.spyOn(remoteCache, "teardown");
  jest.spyOn(remoteCache, "get");
  jest.spyOn(remoteCache, "get");
  jest.spyOn(remoteCache, "set");
  jest.spyOn(remoteCache, "delete");
  jest.spyOn(remoteCache, "touch");
  jest.spyOn(remoteCache, "exists");
  return remoteCache;
};

export class MockRemoteCache implements RemoteCache {
  public streamResponses = false;
  public isSetup = false;
  public isTorndown = false;
  public cache: Record<string, MockCacheEntry> = {};
  public touched: Record<string, number> = {};
  public currentTime = 0;

  public async setup(): Promise<void> {
    await wait();
    this.isSetup = true;
    await wait();
    this.isTorndown = false;
  }

  public async teardown(): Promise<void> {
    await wait();
    this.isSetup = false;
    await wait();
    this.isTorndown = true;
  }

  public async get(
    worker: string,
    ids: string[],
    earlyWrite: (
      id: string,
      value: MockResultObject | Error | undefined
    ) => Promise<void>
  ): Promise<
    | void
    | (MockResultObject | Error | undefined)[]
    | Map<string, MockResultObject | Error | undefined>
  > {
    if (this.streamResponses) {
      for (const id of ids) {
        await wait();
        if (this.cache[`${worker}:${id}`]?.expires > Date.now()) {
          earlyWrite(id, this.cache[`${worker}:${id}`]?.value);
        }
      }
    } else {
      await wait();
      return ids.map((id) => {
        if (this.cache[`${worker}:${id}`]?.expires > Date.now()) {
          return this.cache[`${worker}:${id}`]?.value;
        }
      });
    }
  }

  public async set(
    worker: string,
    entries: RemoteCacheEntry<MockResultObject, string>[]
  ): Promise<void> {
    for (const entry of entries) {
      await wait();
      this.cache[`${worker}:${entry.id}`] = {
        value: entry.value,
        expires: this.currentTime + entry.ttl,
      };
    }
  }

  public async delete(worker: string, ids: string[]): Promise<void> {
    for (const id of ids) {
      await wait();
      if (this.cache[`${worker}:${id}`]) {
        delete this.cache[`${worker}:${id}`];
      }
    }
  }

  public async touch(
    worker: string,
    entries: CacheTouch<string>[]
  ): Promise<void> {
    entries.forEach(({ id }) => (this.touched[`${worker}:${id}`] = Date.now()));
  }

  public async exists(worker: string, ids: string[]): Promise<boolean[]> {
    return ids.map((id) => (this.cache[`${worker}:${id}`] ? true : false));
  }
}
