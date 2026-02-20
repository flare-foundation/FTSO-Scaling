import { DataSource } from "typeorm";
import { EPOCH_SETTINGS } from "../../../libs/ftso-core/src/constants";
import { TLPEvents, TLPState, TLPTransaction } from "../../../libs/ftso-core/src/orm/entities";
import { Feed } from "../../../libs/ftso-core/src/voting-types";
import { generateVoters } from "../basic-generators";
import { generateRewardEpochDataForRewardCalculation } from "../generators-rewards";
import { setupEnvVariables, setupEpochSettings } from "../test-epoch-settings";
import { RewardEpochDataGenerationConfig } from "./interfaces";
import FakeTimers from "@sinonjs/fake-timers";
import { printSummary } from "../indexer-db-summary";
import { emptyLogger } from "../../../libs/ftso-core/src/utils/ILogger";
import { existsSync, rmSync } from "fs";
import { toFeedId } from "../generators";

async function initializeConfig(config: RewardEpochDataGenerationConfig) {
  const logger = config.logger ?? emptyLogger;
  process.env.NETWORK = "from-env";
  setupEpochSettings(config.epochSettings);
  logger.log("Epoch settings used");
  logger.dir(EPOCH_SETTINGS());
  process.env.RANDOM_GENERATION_BENCHING_WINDOW = "1";
  logger.log(`RANDOM_GENERATION_BENCHING_WINDOW = ${process.env.RANDOM_GENERATION_BENCHING_WINDOW}`);
  setupEnvVariables(config.envVariables);
  logger.log("Reward settings used");
  logger.dir(config.envVariables);
}

export function generateFeeds(numberOfFeeds: number): Feed[] {
  const feeds: Feed[] = [];
  for (let i = 0; i < numberOfFeeds; i++) {
    const feedName = `feed${i}`;
    const feedDecimals = 5;
    feeds.push({ id: toFeedId(feedName), decimals: feedDecimals });
  }
  return feeds;
}

export async function runDBGenerator(config: RewardEpochDataGenerationConfig) {
  const clock = FakeTimers.install({ now: Date.now() });
  await initializeConfig(config);
  const feeds = generateFeeds(config.numberOfFeeds);
  const voters = generateVoters(config.numberOfVoters);

  if (existsSync(config.dbPath)) {
    rmSync(config.dbPath);
  }

  const dataSource = new DataSource({
    type: "better-sqlite3",
    database: config.dbPath,
    entities: [TLPTransaction, TLPEvents, TLPState],
    synchronize: true,
  });

  await dataSource.initialize();
  const entityManager = dataSource.createEntityManager();
  const logger = config.logger ?? emptyLogger;
  await generateRewardEpochDataForRewardCalculation(
    clock,
    entityManager,
    config.fspSettings,
    feeds,
    config.communityRewardOfferAmount,
    config.rewardEpochId,
    voters,
    config.valueFunction,
    config.scenario,
    logger
  );
  if (config.printSummary) {
    await printSummary(entityManager, voters, undefined, logger);
  }
  await dataSource.destroy();
  clock.uninstall();
}
