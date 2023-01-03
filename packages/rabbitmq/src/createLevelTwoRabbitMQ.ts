import { LevelTwo } from "@level-two/core";
import {
  RabbitMQMessageBroker,
  RabbitMQMessageBrokerParams,
} from "./RabbitMQRemoteBroadcast";

/**
 * Creates a LevelTwo instance configured with RabbitMQ for broadcasting
 * @param settings RabbitMQ extension settings
 */
export const createLevelTwoRabbitMQ = <WorkerIdentifierType = string>(
  settings: RabbitMQMessageBrokerParams<WorkerIdentifierType>
): LevelTwo<WorkerIdentifierType> => {
  const messageBroker = new RabbitMQMessageBroker<WorkerIdentifierType>(
    settings
  );

  const levelTwo = new LevelTwo<WorkerIdentifierType>({
    cacheDefaults: settings.cacheDefaults,
    remoteCache: settings.remoteCache,
    messageBroker,
  });

  return levelTwo;
};
