import { LevelTwo } from "@level-two/core";
import {
  KafkaMessageBroker,
  KafkaMessageBrokerSettings,
} from "./KafkaMessageBroker";

/**
 * Creates a LevelTwo instance configured with kafka for message broker
 * @param settings Kafka extension settings
 */
export const createLevelTwoKafka = <WorkerIdentifierType = string>(
  settings: KafkaMessageBrokerSettings<WorkerIdentifierType>
): LevelTwo<WorkerIdentifierType> => {
  const messageBroker = new KafkaMessageBroker<WorkerIdentifierType>(settings);

  const levelTwo = new LevelTwo<WorkerIdentifierType>({
    cacheDefaults: settings.cacheDefaults,
    remoteCache: settings.remoteCache,
    messageBroker,
  });

  return levelTwo;
};
