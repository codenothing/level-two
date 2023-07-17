import { LevelTwo, Worker } from "@level-two/core";
import { createClient } from "redis";
import { createLevelTwoRedis } from "../src";
import { wait } from "./util";

const COMPANIES: Record<string, Company> = {
  github: { id: "github", name: "Github" },
  npm: { id: "npm", name: "NPM" },
};

interface Company {
  id: string;
  name: string;
}

describe("RedisIntegration", () => {
  let redis: ReturnType<typeof createClient>;
  let cache1: LevelTwo;
  let cache2: LevelTwo;
  let worker1: Worker<Company, string>;
  let worker2: Worker<Company, string>;

  beforeEach(async () => {
    // Reset customer cache
    redis = createClient({ url: "redis://127.0.0.1:6380" });
    await redis.connect();
    await redis.del("customer:github");
    await redis.del("customer:npm");

    // Create first worker
    cache1 = createLevelTwoRedis({
      clientOptions: { url: "redis://127.0.0.1:6380" },
    });
    worker1 = cache1.createWorker<Company, string>("customer", async (ids) =>
      ids.map((id) => COMPANIES[id])
    );
    await cache1.start();

    // Create second worker
    cache2 = createLevelTwoRedis({
      clientOptions: { url: "redis://127.0.0.1:6380" },
    });
    worker2 = cache2.createWorker<Company, string>("customer", async (ids) => {
      return ids.map((id) => COMPANIES[id]);
    });
    await cache2.start();
  });

  afterEach(async () => {
    await redis.disconnect();
    await cache1.stop();
    await cache2.stop();
  });

  test("should pull values from fetch process and place into caches", async () => {
    expect(await worker1.getMulti(["github", "npm"])).toEqual([
      { id: "github", name: "Github" },
      { id: "npm", name: "NPM" },
    ]);
    expect(await worker2.getMulti(["github", "npm"])).toEqual([
      { id: "github", name: "Github" },
      { id: "npm", name: "NPM" },
    ]);

    // Confirm companies exist in both local caches
    expect(worker1.has("github")).toStrictEqual(true);
    expect(worker1.has("npm")).toStrictEqual(true);
    expect(worker1.has("circleci")).toStrictEqual(false);
    expect(worker2.has("github")).toStrictEqual(true);
    expect(worker2.has("npm")).toStrictEqual(true);
    expect(worker2.has("circleci")).toStrictEqual(false);

    // Confirm companies exist in external cache for both workers
    expect(await worker1.exists("github")).toStrictEqual(true);
    expect(await worker1.exists("npm")).toStrictEqual(true);
    expect(await worker1.exists("circleci")).toStrictEqual(false);
    expect(await worker2.exists("github")).toStrictEqual(true);
    expect(await worker2.exists("npm")).toStrictEqual(true);
    expect(await worker2.exists("circleci")).toStrictEqual(false);
  });

  test("should broadcast value changes across workers", async () => {
    await worker1.get("github");
    await worker2.get("github");

    await Promise.all([
      worker1.set("github", { id: "github", name: "Github Revised" }),
      new Promise<void>((resolve) => {
        worker2.once("upsert", (id) => {
          if (id === "github") {
            resolve();
          }
        });
      }),
    ]);
    expect(worker2.peek("github")?.value).toEqual({
      id: "github",
      name: "Github Revised",
    });
  });

  test("should remove local cache on both workers when deleting", async () => {
    await worker1.get("github");
    await worker2.get("github");
    expect(await worker1.exists("github")).toStrictEqual(true);
    expect(await worker2.exists("github")).toStrictEqual(true);

    await Promise.all([
      worker1.delete("github"),
      new Promise<void>((resolve) => {
        worker2.once("delete", (id) => {
          if (id === "github") {
            resolve();
          }
        });
      }),
    ]);
    expect(worker1.has("github")).toStrictEqual(false);
    expect(worker2.has("github")).toStrictEqual(false);

    // Deleting should also remove the existance check
    expect(await worker1.exists("github")).toStrictEqual(false);
    expect(await worker2.exists("github")).toStrictEqual(false);
  });

  test("should set company and evict once ttl runs out", async () => {
    await worker1.get("github");
    await worker2.get("github");

    await Promise.all([
      worker1.set("github", { id: "github", name: "Github Short TTL" }, 2000),
      new Promise<void>((resolve) => {
        worker2.once("upsert", (id) => {
          if (id === "github") {
            resolve();
          }
        });
      }),
    ]);

    expect(await worker1.exists("github")).toStrictEqual(true);
    expect(await worker2.exists("github")).toStrictEqual(true);
    await wait(2000);
    expect(worker1.has("github")).toStrictEqual(false);
    expect(worker2.has("github")).toStrictEqual(false);
    expect(await worker1.exists("github")).toStrictEqual(false);
    expect(await worker2.exists("github")).toStrictEqual(false);
  });

  test("should upsert new cache data into local cache", async () => {
    expect(await worker1.get("github")).toEqual({
      id: "github",
      name: "Github",
    });

    await redis.set(
      "customer:github",
      JSON.stringify({ id: "github", name: "Github Upserted" })
    );
    expect(await worker1.get("github")).toEqual({
      id: "github",
      name: "Github",
    });
    expect(await worker1.upsert("github")).toEqual({
      id: "github",
      name: "Github Upserted",
    });
    expect(await worker1.get("github")).toEqual({
      id: "github",
      name: "Github Upserted",
    });
  });

  test("should extend ttl through touch", async () => {
    await worker1.set("github", { id: "github", name: "Github Touched" }, 2000);
    expect(worker1.has("github")).toStrictEqual(true);
    expect(await worker1.exists("github")).toStrictEqual(true);

    await wait(1000);
    await worker1.touch("github", 3000);

    await wait(1500);
    expect(worker1.has("github")).toStrictEqual(true);
    expect(await worker1.exists("github")).toStrictEqual(true);

    await wait(2000);
    expect(worker1.has("github")).toStrictEqual(false);
    expect(await worker1.exists("github")).toStrictEqual(false);
  });
});
