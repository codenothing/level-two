import Benchmark from "benchmark";
import { LevelTwo } from "../src";

const BATCH_COUNT = [100, 50, 25, 5, 1];

const tick = () => new Promise((resolve) => process.nextTick(resolve));

const generateIds = (count: number) =>
  new Array(count).fill(0).map((_v, i) => i + 1);

const levelTwo = new LevelTwo();

const configWorker = levelTwo.createSingleKeyWorker("config", async () => ({
  config: true,
}));

const worker = levelTwo.createWorker<number, number>(
  "get",
  async (ids, earlyWrite) => {
    await tick();
    ids.forEach((id) => earlyWrite(id, id * 2));
  }
);

const suite = new Benchmark.Suite();

suite.add(`get`, {
  defer: true,
  fn: async (deferred: Benchmark.Deferred) => {
    await worker.get(1);
    deferred.resolve();
  },
});

suite.add(`get single-key`, {
  defer: true,
  fn: async (deferred: Benchmark.Deferred) => {
    await configWorker.get();
    deferred.resolve();
  },
});

BATCH_COUNT.forEach((idCount) => {
  const ids = generateIds(idCount);
  suite.add(`getMulti ${ids.length} ids`, {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      await worker.getMulti(ids);
      deferred.resolve();
    },
  });
});

BATCH_COUNT.forEach((idCount) => {
  const ids = generateIds(idCount);
  suite.add(`getUnsafeMulti ${ids.length} ids`, {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      await worker.getUnsafeMulti(ids);
      deferred.resolve();
    },
  });
});

BATCH_COUNT.forEach((idCount) => {
  const ids = generateIds(idCount);
  suite.add(`getRequiredMulti ${ids.length} ids`, {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      await worker.getRequiredMulti(ids);
      deferred.resolve();
    },
  });
});

BATCH_COUNT.forEach((idCount) => {
  const ids = generateIds(idCount);
  suite.add(`getEntryMulti ${ids.length} ids`, {
    defer: true,
    fn: async (deferred: Benchmark.Deferred) => {
      await worker.getEntryMulti(ids);
      deferred.resolve();
    },
  });
});

suite
  .on("cycle", (event: Benchmark.Event) => {
    console.log(String(event.target));
  })
  .on("complete", () => levelTwo.stop());

// Setup before running the suite
(async () => {
  await levelTwo.start();

  // Warm up local cache
  await worker.getMulti(generateIds(100));

  // Run the suite
  suite.run({ async: true });
})();
