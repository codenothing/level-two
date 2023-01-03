import Benchmark from "benchmark";
import { readFileSync } from "fs";
import { createClient } from "redis";
import { LevelTwo } from "../src";

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

const redis = createClient();

const getCustomers = async (ids: number[]): Promise<Customer[]> => {
  const customers = await redis.mGet(
    ids.map((id) => `benchmark:level-two:customer:${id}`)
  );

  return customers
    .filter((value) => value !== null)
    .map((value) => JSON.parse(value as string));
};

const suite = new Benchmark.Suite();
const levelTwo = new LevelTwo();
const worker = levelTwo.createWorker<Customer, number>(
  "customer",
  async (ids, earlyWrite) => {
    (await getCustomers(ids)).forEach((customer) =>
      earlyWrite(customer.id, customer)
    );
  }
);

// Redis
[1, 5, 25, 50, customers.size].forEach((idCount) => {
  const ids = Array.from(customers.values())
    .slice(0, idCount)
    .map((customer) => customer.id);

  suite.add(`Redis Direct - Fetch ${idCount} entries`, {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      await getCustomers(ids);
      deferred.resolve();
    },
  });
});

// LevelTwo
[1, 5, 25, 50, customers.size].forEach((idCount) => {
  const ids = Array.from(customers.values())
    .slice(0, idCount)
    .map((customer) => customer.id);

  suite.add(`Level Two - Fetch ${idCount} entries`, {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      await worker.getMulti(ids);
      deferred.resolve();
    },
  });
});

suite
  .on("cycle", (event: Benchmark.Event) => {
    if (event.target.name?.startsWith("Level Two - Fetch 1 ")) {
      console.log("---");
    }
    console.log(String(event.target));
  })
  .on("complete", () => {
    levelTwo.stop();
    redis.quit();
  });

// Setup before running the suite
(async () => {
  // Start the redis server
  await levelTwo.start();
  await redis.connect();

  // Prime the cache
  for (const [id, value] of customers) {
    await redis.set(
      `benchmark:level-two:customer:${id}`,
      JSON.stringify(value)
    );
  }

  // Prime the worker cache
  await worker.getMulti(Array.from(customers.keys()));

  // Run the suite
  suite.run({ async: true });
})();
