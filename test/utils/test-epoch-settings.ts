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

let stashedEnvVariables: any | undefined;

export function setupEnvVariables(settings: any) {
  if (process.env.NETWORK !== "from-env") {
    throw new Error("This works only for setup from environment enabled");
  }
  if (stashedEnvVariables) {
    throw new Error("Stashed env variables settings already exists");
  }
  stashedEnvVariables = settings;
  internalSetupEnvVariables(settings);
}

export function resetEnvVariables() {
  if (process.env.NETWORK !== "from-env") {
    throw new Error("This works only for setup from environment enabled");
  }
  if (!stashedEnvVariables) {
    throw new Error("No stashed epoch settings");
  }
  internalSetupEnvVariables(stashedEpochSettings);
  stashedEnvVariables = undefined;
}

function internalSetupEnvVariables(config: any) {
  if (process.env.NETWORK !== "from-env") {
    throw new Error("This works only for setup from environment enabled");
  }
  for (const key in config) {
    if (typeof config[key] !== "string" && typeof config[key] !== "number" && typeof config[key] !== "bigint") {
      throw new Error(`Invalid type for ${key}, expected string, number or bigint, got ${typeof config[key]}`);
    }
    process.env[key] = config[key].toString();
  }
}

export const defaultSigningPolicyProtocolSettings: FSPSettings = {
  newSigningPolicyInitializationStartSeconds: 40,
  voterRegistrationMinDurationSeconds: 10,
  signingPolicyThresholdPPM: 500000,
};
export const realtimeShorterEpochSettings: EpochSettingsConfig = {
  // DO NOT CHANGE THOSE SETTINGS AS TESTS BASE ON THEM
  firstVotingRoundStartTs: 1704250616,
  votingEpochDurationSeconds: 90,
  firstRewardEpochStartVotingRoundId: 1000,
  rewardEpochDurationInVotingEpochs: 5,
  revealDeadlineSeconds: 30,
};

export const rewardSettingsForRealtimeShorterEpochSettings = {
  PENALTY_FACTOR: 30n,
  GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC: 10,
  GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC: 20,
  MINIMAL_REWARDED_NON_CONSENSUS_DEPOSITED_SIGNATURES_PER_HASH_BIPS: 3000,
  FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS: 500,
}
