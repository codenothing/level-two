import Benchmark from "benchmark";
import { readFileSync } from "fs";
import { createPool } from "mysql";
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

const pool = createPool({
  connectionLimit: 10,
  host: process.env.MYSQL_BENCHMARK_HOST || "127.0.0.1",
  user: process.env.MYSQL_BENCHMARK_USER,
  password: process.env.MYSQL_BENCHMARK_PASSWORD,
  database: process.env.MYSQL_BENCHMARK_DATABASE,
});

const getCustomers = async (ids: number[]) => {
  return new Promise<Customer[]>((resolve, reject) => {
    pool.query(
      `SELECT id, name FROM customers WHERE id IN (?)`,
      [ids],
      (e, results?: Customer[]) => {
        if (e || !results || !results.length) {
          reject(e || new Error(`Customers not found`));
        } else {
          resolve(results);
        }
      }
    );
  });
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

// MySQL
[1, 5, 25, 50, customers.size].forEach((idCount) => {
  const ids = Array.from(customers.values())
    .slice(0, idCount)
    .map((customer) => customer.id);

  suite.add(`MySQL Direct - Fetch ${idCount} entries`, {
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
    pool.end();
  });

// Setup before running the suite
(async () => {
  // Start the level two instance
  await levelTwo.start();

  await new Promise<void>((resolve, reject) => {
    const values = Array.from(customers.values()).map((customer) => [
      customer.id,
      customer.name,
    ]);
    pool.query(`INSERT INTO customers(id, name) VALUES ?`, [values], (e) => {
      if (e) {
        reject(e);
      } else {
        resolve();
      }
    });
  });

  // Prime the worker cache
  await worker.getMulti(Array.from(customers.keys()));

  // Run the suite
  suite.run({ async: true });
})();
