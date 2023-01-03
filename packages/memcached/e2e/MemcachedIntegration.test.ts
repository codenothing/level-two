import { LevelTwo, Worker } from "@level-two/core";
import Memcached from "memcached";
import { promisify } from "util";
import { wait } from "./util";
import { MemcachedRemoteCache } from "../src";

const COMPANIES: Record<string, Company> = {
  github: { id: "github", name: "Github" },
  npm: { id: "npm", name: "NPM" },
};

interface Company {
  id: string;
  name: string;
}

describe("MemcachedIntegration", () => {
  let memcached: Memcached;
  let levelTwo: LevelTwo;
  let worker: Worker<Company, string>;

  beforeEach(async () => {
    // Reset customer cache
    memcached = new Memcached("127.0.0.1:11222");
    await promisify(memcached.del.bind(memcached))("customer:github");
    await promisify(memcached.del.bind(memcached))("customer:npm");

    // Create first worker
    levelTwo = new LevelTwo({
      remoteCache: new MemcachedRemoteCache("127.0.0.1:11222"),
    });
    worker = levelTwo.createWorker<Company, string>("customer", async (ids) =>
      ids.map((id) => COMPANIES[id])
    );
    await levelTwo.start();
  });

  afterEach(async () => {
    memcached.end();
    await levelTwo.stop();
  });

  test("should pull values from fetch process and place into caches", async () => {
    expect(await worker.getMulti(["github", "npm"])).toEqual([
      { id: "github", name: "Github" },
      { id: "npm", name: "NPM" },
    ]);

    // Confirm companies exist in both local caches
    expect(worker.has("github")).toStrictEqual(true);
    expect(worker.has("npm")).toStrictEqual(true);
    expect(worker.has("circleci")).toStrictEqual(false);

    // Confirm companies exist in external cache for both workers
    expect(await worker.exists("github")).toStrictEqual(true);
    expect(await worker.exists("npm")).toStrictEqual(true);
    expect(await worker.exists("circleci")).toStrictEqual(false);
  });

  test("should remove local cache on both workers when deleting", async () => {
    await worker.get("github");
    expect(await worker.exists("github")).toStrictEqual(true);

    await worker.delete("github");
    expect(worker.has("github")).toStrictEqual(false);

    // Deleting should also remove the existance check
    expect(await worker.exists("github")).toStrictEqual(false);
  });

  test("should set company and evict once ttl runs out", async () => {
    await worker.get("github");

    await worker.set(
      "github",
      { id: "github", name: "Github Short TTL" },
      2000
    );
    expect(await worker.exists("github")).toStrictEqual(true);

    await wait(2000);
    expect(worker.has("github")).toStrictEqual(false);
    expect(await worker.exists("github")).toStrictEqual(false);
  });

  test("should upsert new cache data into local cache", async () => {
    expect(await worker.get("github")).toEqual({
      id: "github",
      name: "Github",
    });

    await promisify(memcached.set.bind(memcached))(
      "customer:github",
      JSON.stringify({ id: "github", name: "Github Upserted" }),
      60000
    );
    expect(await worker.get("github")).toEqual({
      id: "github",
      name: "Github",
    });
    expect(await worker.upsert("github")).toEqual({
      id: "github",
      name: "Github Upserted",
    });
    expect(await worker.get("github")).toEqual({
      id: "github",
      name: "Github Upserted",
    });
  });

  test("should extend ttl through touch", async () => {
    await worker.set("github", { id: "github", name: "Github Touched" }, 2000);
    expect(worker.has("github")).toStrictEqual(true);
    expect(await worker.exists("github")).toStrictEqual(true);

    await wait(1000);
    await worker.touch("github", 3000);

    await wait(1500);
    expect(worker.has("github")).toStrictEqual(true);
    expect(await worker.exists("github")).toStrictEqual(true);

    await wait(2000);
    expect(worker.has("github")).toStrictEqual(false);
    expect(await worker.exists("github")).toStrictEqual(false);
  });
});
