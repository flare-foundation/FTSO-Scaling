// IMPORTANT: This file should never import networks.ts. 
// The functions in this file are intended to be used in tests only and should be executed 
// before network.ts is imported. This is to ensure that the environment variables are set properly.
export interface EpochSettingsConfig {
  firstVotingRoundStartTs: number;
  votingEpochDurationSeconds: number;
  firstRewardEpochStartVotingRoundId: number;
  rewardEpochDurationInVotingEpochs: number;
  revealDeadlineSeconds: number;
}

export interface FSPSettings {
  newSigningPolicyInitializationStartSeconds: number;
  voterRegistrationMinDurationSeconds: number;
  signingPolicyThresholdPPM: number;
}

let stashedEpochSettings: EpochSettingsConfig | undefined;

export function setupEpochSettings(config: EpochSettingsConfig) {
  if (process.env.NETWORK !== "from-env") {
    throw new Error("This works only for setup from environment enabled");
  }
  if (stashedEpochSettings) {
    throw new Error("Stashed epoch settings already exists");
  }
  stashedEpochSettings = {
    firstVotingRoundStartTs: parseInt(process.env.ES_FIRST_VOTING_ROUND_START_TS!),
    votingEpochDurationSeconds: parseInt(process.env.ES_VOTING_EPOCH_DURATION_SECONDS!),
    firstRewardEpochStartVotingRoundId: parseInt(process.env.ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID!),
    rewardEpochDurationInVotingEpochs: parseInt(process.env.ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS!),
    revealDeadlineSeconds: parseInt(process.env.FTSO_REVEAL_DEADLINE_SECONDS!),
  };
  internalSetupEpochSettings(config);
}

export function resetEpochSettings() {
  if (process.env.NETWORK !== "from-env") {
    throw new Error("This works only for setup from environment enabled");
  }
  if (!stashedEpochSettings) {
    throw new Error("No stashed epoch settings");
  }
  internalSetupEpochSettings(stashedEpochSettings);
  stashedEpochSettings = undefined;
}

function internalSetupEpochSettings(config: EpochSettingsConfig) {
  if (process.env.NETWORK !== "from-env") {
    throw new Error("This works only for setup from environment enabled");
  }
  process.env.ES_FIRST_VOTING_ROUND_START_TS = config.firstVotingRoundStartTs.toString();
  process.env.ES_VOTING_EPOCH_DURATION_SECONDS = config.votingEpochDurationSeconds.toString();
  process.env.ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID = config.firstRewardEpochStartVotingRoundId.toString();
  process.env.ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS = config.rewardEpochDurationInVotingEpochs.toString();
  process.env.FTSO_REVEAL_DEADLINE_SECONDS = config.revealDeadlineSeconds.toString();
}
export const defaultSigningPolicyProtocolSettings: FSPSettings = {
  newSigningPolicyInitializationStartSeconds: 40,
  voterRegistrationMinDurationSeconds: 10,
  signingPolicyThresholdPPM: 500000,
};
export const realtimeShorterEpochSettings: EpochSettingsConfig = {
  firstVotingRoundStartTs: 1704250616,
  votingEpochDurationSeconds: 90,
  firstRewardEpochStartVotingRoundId: 1000,
  rewardEpochDurationInVotingEpochs: 20,
  revealDeadlineSeconds: 30,
};
