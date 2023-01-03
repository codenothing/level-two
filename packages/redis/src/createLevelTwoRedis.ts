import { LevelTwo, LevelTwoSettings } from "@level-two/core";
import { createClient, RedisClientOptions } from "redis";
import { RedisMessageBroker } from "./RedisMessageBroker";
import { RedisRemoteCache } from "./RedisRemoteCache";

/**
 * Redis extension settings
 */
export interface LevelTwoRedisSettings<WorkerIdentifierType = string> {
  /**
   * Existing redis client that should be used in this extension
   */
  redis?: ReturnType<typeof createClient>;

  /**
   * Configuration options for creating a new redis client in this extension
   */
  clientOptions?: RedisClientOptions;

  /**
   * Broadcast channel name for sending/receiving actions. Defaults to "level-two-broadcast"
   */
  broadcastChannel?: string;

  /**
   * String prefix to use in front of each cache key
   */
  cachePrefix?: string;

  /**
   * Indicates if cache should be disabled or not. Defaults to enabled
   */
  cacheDisabled?: true;

  /**
   * LevelTwo worker cache defaults
   */
  cacheDefaults?: LevelTwoSettings<WorkerIdentifierType>["cacheDefaults"];
}

/**
 * Creates a LevelTwo instance configured with redis for broadcasting and caching
 * @param settings Redis extension settings
 */
export const createLevelTwoRedis = <WorkerIdentifierType = string>(
  settings?: LevelTwoRedisSettings<WorkerIdentifierType>
): LevelTwo<WorkerIdentifierType> => {
  const redis = settings?.redis || createClient(settings?.clientOptions);
  const messageBroker = new RedisMessageBroker<WorkerIdentifierType>(
    redis,
    settings
  );

  // Always create a caching interface unless directed not to
  let remoteCache: RedisRemoteCache<WorkerIdentifierType> | undefined;
  if (settings?.cacheDisabled !== true) {
    remoteCache = new RedisRemoteCache<WorkerIdentifierType>(redis, settings);
  }

  const levelTwo = new LevelTwo<WorkerIdentifierType>({
    cacheDefaults: settings?.cacheDefaults,
    messageBroker,
    remoteCache,
  });

  return levelTwo;
};
