# LevelTwo - RabbitMQ

A message broker extension for [LevelTwo](https://www.npmjs.com/package/@level-two/core). Refer to the [Worker API](https://www.npmjs.com/package/@level-two/core#worker-api) for function definitions.

## Usage

```ts
import { createLevelTwoRabbitMQ } from "@level-two/rabbitmq";

// Integrates RabbitMQ message broker into a LevelTwo instance
const levelTwo = createLevelTwoRabbitMQ({
  url: "amqp://localhost:5673/",
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

### `url`

Endpoint for connecting client to

### `broadcastChannel`

Broadcast channel name for sending/receiving actions

### `consumeOptions`

Options when adding consumer listener

### `consumerExchangeOptions`

Options when declaring the consumer exchange

### `consumerQueueOptions`

Options when declaring the consumer queue

### `publishOptions`

Options when publishing a message

### `publisherExchangeOptions`

Options when declaring the publisher exchange

### `remoteCache`

LevelTwo remote cache extension

### `cacheDefaults`

LevelTwo worker cache defaults
