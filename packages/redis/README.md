# LevelTwo - Redis

A message broker and cache extension for [LevelTwo](https://www.npmjs.com/package/@level-two/core). Refer to the [Worker API](../core#worker-api) for function definitions.

## Usage

```ts
import { createLevelTwoRedis } from "@level-two/redis";

// Integrates redis pubsub & cache into a LevelTwo instance
const levelTwo = createLevelTwoRedis({
  clientOptions: { url: "redis://localhost:6379" },
});

// Create a worker for getting cacheable customer objects
const worker = levelTwo.createWorker("customer", async (ids, earlyWrite) => {
  const rows = await mysql.query(
    "SELECT id, name FROM customers WHERE id IN (?)",
    [ids]
  );

  rows.forEach((row) => earlyWrite(row.id, row));
});

// Service method for getting a single customer
export async function getCustomer(id: string): Promise<Customer> {
  return await worker.get(id);
}

// Service method for getting a list of customers
export async function getCustomerList(ids: string[]): Promise<Customer[]> {
  return await worker.getMulti(ids);
}
```

## Settings

### `redis`

Existing redis client that should be used in this extension

### `clientOptions`

Configuration options for creating a new redis client

### `broadcastChannel`

Broadcast channel name for sending/receiving actions. Defaults to "level-two-broadcast"

### `cachePrefix`

String prefix to use in front of each cache key

### `cacheDisabled`

Indicates if cache should be disabled or not. Defaults to enabled

### `cacheDefaults`

LevelTwo worker cache defaults
