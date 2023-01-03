# LevelTwo - Memcached

A cache extension for [LevelTwo](https://www.npmjs.com/package/@level-two/core). Refer to the [Worker API](../core#worker-api) for function definitions.

## Usage

```ts
import { MemcachedRemoteCache } from "@level-two/memcached";
import { LevelTwo } from "@level-two/core";

// Adds memcached onto a LevelTwo instance
const levelTwo = new LevelTwo({
  remoteCache: new MemcachedRemoteCache("localhost:11211"),
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

### `cachePrefix`

String prefix to use in front of each cache key

### `clientOptions`

Configuration options for creating a new Memcached client
