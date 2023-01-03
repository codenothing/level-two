# LevelTwo - Kafka

A message broker extension for [LevelTwo](https://www.npmjs.com/package/@level-two/core). Refer to the [Worker API](../core#worker-api) for function definitions.

## Usage

```ts
import { createLevelTwoKafka } from "@level-two/kafka";

// Integrates RabbitMQ message broker into a LevelTwo instance
const levelTwo = createLevelTwoKafka({
  topic: "level-two-broadcast",
  clientOptions: {
    brokers: ["localhost:9092"],
  },
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

### `topic`

Topic name for sending/receiving actions

### `clientOptions`

Kafka client options

### `consumerOptions`

Consumer connection options

### `producerOptions`

Producer connection options

### `remoteCache`

LevelTwo remote cache extension

### `cacheDefaults`

LevelTwo worker cache defaults
