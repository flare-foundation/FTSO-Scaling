import { ILogger } from "../../../libs/ftso-core/src/utils/ILogger";
import { Feed } from "../../../libs/ftso-core/src/voting-types";
import { RewardDataSimulationScenario } from "../generators-rewards";
import { EpochSettingsConfig, FSPSettings } from "../test-epoch-settings";

export interface DBGenerationENVVariables {
  RANDOM_GENERATION_BENCHING_WINDOW: number;
  PENALTY_FACTOR: bigint;
  GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC: number;
  GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC: number;
  MINIMAL_REWARDED_NON_CONSENSUS_DEPOSITED_SIGNATURES_PER_HASH_BIPS: number;
  FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS: number;
}

export interface RewardEpochDataGenerationConfig {
  rewardEpochId: number;
  epochSettings: EpochSettingsConfig;
  envVariables: DBGenerationENVVariables;
  numberOfFeeds: number;
  numberOfVoters: number;
  numberOfInflationOffersForAllFeeds: number;
  numberOfCommunityOffersForEachFeed: number;
  fspSettings: FSPSettings;
  communityRewardOfferAmount: bigint;
  valueFunction: (votingRoundId: number, voterIndex: number, feedSequence: Feed[]) => number[];
  scenario: RewardDataSimulationScenario;
  dbPath: string;
  logger?: ILogger;
  printSummary?: boolean;
}
