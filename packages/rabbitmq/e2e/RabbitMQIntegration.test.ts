import { LevelTwo, Worker } from "@level-two/core";
import { createLevelTwoRabbitMQ } from "../src";
import { wait } from "./util";

interface Company {
  id: string;
  name: string;
}

describe("RabbitMQIntegration", () => {
  let cache1: LevelTwo;
  let cache2: LevelTwo;
  let worker1: Worker<Company, string>;
  let worker2: Worker<Company, string>;
  let COMPANIES: Record<string, Company>;

  beforeEach(async () => {
    COMPANIES = {
      github: { id: "github", name: "Github" },
      npm: { id: "npm", name: "NPM" },
    };

    // Create first worker
    cache1 = createLevelTwoRabbitMQ({
      url: "amqp://127.0.0.1:5673/",
    });
    worker1 = cache1.createWorker<Company, string>("customer", async (ids) =>
      ids.map((id) => COMPANIES[id])
    );
    await cache1.start();

    // Create second worker
    cache2 = createLevelTwoRabbitMQ({
      url: "amqp://127.0.0.1:5673/",
    });
    worker2 = cache2.createWorker<Company, string>("customer", async (ids) => {
      return ids.map((id) => COMPANIES[id]);
    });
    await cache2.start();
  });

  afterEach(async () => {
    await cache1.stop();
    await cache2.stop();
  });

  test("should broadcast value changes across workers", async () => {
    await worker1.get("github");
    await worker2.get("github");

    COMPANIES.github = { id: "github", name: "Github Revised" };
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
    expect(worker1.has("github")).toStrictEqual(true);
    expect(worker2.has("github")).toStrictEqual(true);

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

    expect(worker1.has("github")).toStrictEqual(true);
    expect(worker2.has("github")).toStrictEqual(true);
    await wait(2100);
    expect(worker1.has("github")).toStrictEqual(false);
    expect(worker2.has("github")).toStrictEqual(false);
  });
});
