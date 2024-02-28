
import { DataSource } from "typeorm";
import { EPOCH_SETTINGS } from "../../../libs/ftso-core/src/configs/networks";
import { TLPEvents, TLPState, TLPTransaction } from "../../../libs/ftso-core/src/orm/entities";
import { Feed } from "../../../libs/ftso-core/src/voting-types";
import { generateVoters } from "../basic-generators";
import { generateFeedName } from "../generators";
import { generateRewardEpochDataForRewardCalculation } from "../generators-rewards";
import { setupEnvVariables, setupEpochSettings } from "../test-epoch-settings";
import { RewardEpochDataGenerationConfig } from "./interfaces";
import FakeTimers from "@sinonjs/fake-timers";
import { printSummary } from "../indexer-db-summary";
import { emptyLogger } from "../../../libs/ftso-core/src/utils/ILogger";
import { existsSync, rmSync } from "fs";

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
      feeds.push({ name: generateFeedName(feedName), decimals: feedDecimals });
   }
   return feeds;
}

export async function runDBGenerator(config: RewardEpochDataGenerationConfig) {
   const clock = FakeTimers.install({ now: Date.now() });
   initializeConfig(config);
   const feeds = generateFeeds(config.numberOfFeeds);
   const voters = generateVoters(config.numberOfVoters)

   if (existsSync(config.dbPath)) {
      rmSync(config.dbPath);
   }

   const dataSource = new DataSource({
      type: "sqlite",
      database: config.dbPath,
      entities: [TLPTransaction, TLPEvents, TLPState],
      synchronize: true,
      flags: undefined,
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
}
