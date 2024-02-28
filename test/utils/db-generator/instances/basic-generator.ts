// running:
// env NETWORK=local-test yarn ts-node test/utils/db-generator/instances/basic-generator.ts
import { happyRewardDataSimulationScenario, voterFeedValue } from "../../generators-rewards";
import { defaultSigningPolicyProtocolSettings, realtimeShorterEpochSettings, rewardSettingsForRealtimeShorterEpochSettings } from "../../test-epoch-settings";
import { runDBGenerator } from "../db-generator";
import { RewardEpochDataGenerationConfig } from "../interfaces";

const config: RewardEpochDataGenerationConfig = {
   rewardEpochId: 1,
   epochSettings: realtimeShorterEpochSettings,
   envVariables: rewardSettingsForRealtimeShorterEpochSettings,
   numberOfFeeds: 3,
   numberOfVoters: 10,
   numberOfInflationOffersForAllFeeds: 0,
   numberOfCommunityOffersForEachFeed: 1,
   fspSettings: defaultSigningPolicyProtocolSettings,
   communityRewardOfferAmount: 1000000n,
   valueFunction: voterFeedValue,
   scenario: happyRewardDataSimulationScenario,
   dbPath: "test-db/basic-test.db",
   logger: console,
   printSummary: true,
}

runDBGenerator(config)
   .then(() => process.exit(0))
   .catch((error) => {
      // log something
      process.exit(1);
   });
