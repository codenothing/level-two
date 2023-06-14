import Benchmark from "benchmark";
import Memcached from "memcached";
import { readFileSync } from "fs";
import { MemcachedRemoteCache } from "../src";
import { LevelTwo } from "@level-two/core";
import { promisify } from "util";

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

const cache = new Memcached("127.0.0.1:11211");
const cacheGet = promisify(cache.get.bind(cache));
const cacheGetMulti = promisify(cache.getMulti.bind(cache));

const remoteCache = new MemcachedRemoteCache("127.0.0.1:11211");
const levelTwo = new LevelTwo({
  remoteCache,
});

const worker = levelTwo.createWorker<Customer, number>(
  "customer",
  async (ids) => {
    return ids.map((id) => customers.get(id));
  }
);

suite.add("Memcached Direct - Single Get", {
  defer: true,
  fn: async (deferred: Benchmark.Deferred) => {
    const result = await cacheGet("benchmark:level-two-memcached:1");
    if (typeof result === "string") {
      try {
        JSON.parse(result);
      } catch (e) {
        console.error(`cache parser error:`, e);
      }
    }
    deferred.resolve();
  },
});

[5, 25, 100].forEach((idCount) => {
  const memcachedIds = generateIds(idCount).map(
    (id) => `benchmark:level-two-memcached:${id}`
  );

  suite.add(`Memcached Direct - Get ${idCount} entries`, {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      const results = await cacheGetMulti(memcachedIds);
      for (const id in results) {
        JSON.parse(results[id]);
      }
      deferred.resolve();
    },
  });
});

suite.add("Level Two - Single Get", {
  defer: true,
  fn: async (deferred: Benchmark.Deferred) => {
    await worker.get(1);
    deferred.resolve();
  },
});

[5, 25, 100].forEach((idCount) => {
  const ids = generateIds(idCount);

  suite.add(`Level Two - Get ${idCount} entries`, {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      await worker.getMulti(ids);
      deferred.resolve();
    },
  });
});

suite
  .on("cycle", (event: Benchmark.Event) => {
    if (event.target.name === "Level Two - Single Get") {
      console.log("----------");
    }
    console.log(String(event.target));
  })
  .on("complete", () => levelTwo.stop());

// Setup before running the suite
(async () => {
  // Start the cache runner
  await levelTwo.start();

  // Prime the cache
  const setCache = promisify(cache.set.bind(cache));
  for (const [id, value] of customers) {
    await setCache(
      `benchmark:level-two-memcached:${id}`,
      JSON.stringify(value),
      3600
    );
  }

  // Prime the worker cache
  await worker.getMulti(Array.from(customers.keys()));

  // Run the suite
  console.log("Cache and workers primed, running the suite");
  suite.run({ async: true });
})();
