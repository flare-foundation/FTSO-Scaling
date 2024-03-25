// running:
// env NETWORK=local-test yarn ts-node test/utils/db-generator/instances/full-reward-epoch-100-voters.ts

import { voterFeedValue } from "../../generators-rewards";
import { runDBGenerator } from "../db-generator";
import { RewardEpochDataGenerationConfig } from "../interfaces";

const config: RewardEpochDataGenerationConfig = {
  rewardEpochId: 1,
  epochSettings: {
    firstVotingRoundStartTs: 1704250616,
    votingEpochDurationSeconds: 90,
    firstRewardEpochStartVotingRoundId: 1000,
    rewardEpochDurationInVotingEpochs: 3360,
    revealDeadlineSeconds: 30,
  },
  envVariables: {
    RANDOM_GENERATION_BENCHING_WINDOW: 1,
    PENALTY_FACTOR: 30n,
    GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC: 10,
    GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC: 20,
    MINIMAL_REWARDED_NON_CONSENSUS_DEPOSITED_SIGNATURES_PER_HASH_BIPS: 3000,
    FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS: 100,
  },
  numberOfFeeds: 10,
  numberOfVoters: 100,
  numberOfInflationOffersForAllFeeds: 0,
  numberOfCommunityOffersForEachFeed: 1,
  fspSettings: {
    newSigningPolicyInitializationStartSeconds: 40,
    voterRegistrationMinDurationSeconds: 10,
    signingPolicyThresholdPPM: 500000,
  },
  communityRewardOfferAmount: 1000000n,
  valueFunction: voterFeedValue,
  scenario: {
    noSignatureSubmitters: [
      {
        voterIndices: [0],
        votingRoundIds: [4361, 4362, 4363, 4364, 4365],
      },
    ],
    noGracePeriodFinalizers: [],
    outsideGracePeriodFinalizers: [],
    doubleSigners: [
      {
        voterIndices: [70],
        votingRoundIds: [5500],
      },
      {
        voterIndices: [71],
        votingRoundIds: [5600],
      },
    ],
    revealOffenders: [
      {
        voterIndices: [50],
        votingRoundIds: [5000],
      },
      {
        voterIndices: [51],
        votingRoundIds: [5200],
      },
    ],
    independentFinalizersOutsideGracePeriod: [],
    useFixedCalculationResult: true,
  },
  dbPath: "test-db/full-test.db",
  logger: console,
  // printSummary: true,
};

runDBGenerator(config)
  .then(() => {
    console.log("DB generation finished");
    process.exit(0);
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
