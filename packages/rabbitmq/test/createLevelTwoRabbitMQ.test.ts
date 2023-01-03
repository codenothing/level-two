import { LevelTwo } from "@level-two/core";
import { createLevelTwoRabbitMQ, RabbitMQMessageBroker } from "../src";

describe("createLevelTwoRabbitMQ", () => {
  test("should generate a new levelTwo instance with settings passed in", () => {
    const levelTwo = createLevelTwoRabbitMQ({
      url: "amqp://localhost",
      broadcastChannel: "my-channel-name",
      cacheDefaults: { ttl: 45 },
    });
    expect(levelTwo).toBeInstanceOf(LevelTwo);
    expect(levelTwo.messageBroker).toBeInstanceOf(RabbitMQMessageBroker);
    expect(
      (levelTwo.messageBroker as RabbitMQMessageBroker<string>).broadcastChannel
    ).toStrictEqual("my-channel-name");
    expect(levelTwo.settings.cacheDefaults?.ttl).toStrictEqual(45);
  });
});
