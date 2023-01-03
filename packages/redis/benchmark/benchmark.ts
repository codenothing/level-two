import Benchmark from "benchmark";
import { readFileSync } from "fs";
import { createClient } from "redis";
import { createLevelTwoRedis } from "../src";

const companyNames = readFileSync(`${__dirname}/companies.txt`, "utf-8")
  .trim()
  .split(/\n/g);

interface Customer {
  id: number;
  name: string;
}

const customers = new Map<number, Customer>();
companyNames.forEach((company, index) => {
  const id = index + 1;
  customers.set(id, { id, name: company });
});

const suite = new Benchmark.Suite();

const generateIds = (count: number) =>
  new Array(count).fill(0, 0, count).map((_v, i) => i + 1);

const redis = createClient();
const levelTwo = createLevelTwoRedis({
  redis,
  cachePrefix: "benchmark",
});
const worker = levelTwo.createWorker<Customer, number>(
  "animal",
  async (ids, earlyWrite) => {
    const results = await redis.mGet(
      ids.map((id) => `benchmark:level-two-redis:${id}`)
    );
    results.forEach((row, index) => {
      earlyWrite(
        ids[index],
        typeof row === "string" ? JSON.parse(row) : undefined
      );
    });
  }
);

suite.add("Redis Direct - Single Fetch", {
  defer: true,
  fn: async (deferred: Benchmark.Deferred) => {
    const result = await redis.get("benchmark:level-two-redis:1");
    if (typeof result === "string") {
      JSON.parse(result);
    }
    deferred.resolve();
  },
});

[5, 25, 100].forEach((idCount) => {
  const redisIds = generateIds(idCount).map(
    (id) => `benchmark:level-two-redis:${id}`
  );

  suite.add(`Redis Direct - Fetch ${idCount} entries`, {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      const results = await redis.mGet(redisIds);
      results.forEach((row) => {
        if (typeof row === "string") {
          JSON.parse(row);
        }
      });
      deferred.resolve();
    },
  });
});

suite.add("Level One - Single Get", {
  defer: true,
  fn: async (deferred: Benchmark.Deferred) => {
    await worker.get(1);
    deferred.resolve();
  },
});

[5, 25, 100].forEach((idCount) => {
  const ids = generateIds(idCount);

  suite.add(`Level One - Get ${idCount} entries`, {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      await worker.getMulti(ids);
      deferred.resolve();
    },
  });
});

suite
  .on("cycle", (event: Benchmark.Event) => {
    if (event.target.name === "Level One - Single Get") {
      console.log("----------");
    }
    console.log(String(event.target));
  })
  .on("complete", () => levelTwo.stop());

// Setup before running the suite
(async () => {
  // Start the redis server
  await levelTwo.start();

  // Prime the cache
  for (const [id, value] of customers) {
    await redis.set(`benchmark:level-two-redis:${id}`, JSON.stringify(value));
  }

  // Prime the worker cache
  await worker.getMulti(Array.from(customers.keys()));

  // Run the suite
  console.log("Cache and workers primed, running the suite");
  suite.run({ async: true });
})();
