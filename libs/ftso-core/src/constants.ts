import { RewardEpochStarted } from "../../contracts/src/events";
import { EpochSettings } from "./utils/EpochSettings";
import { networks } from "../../contracts/src/constants";

// State names in indexer database
export const LAST_CHAIN_INDEX_STATE = "last_chain_block";
export const LAST_DATABASE_INDEX_STATE = "last_database_block";
export const FIRST_DATABASE_INDEX_STATE = "first_database_block";
export const FIRST_DATABASE_LOG_INDEX_STATE = "first_database_log_block";

const ftso2ProtocolId = () => {
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "coston":
    case "from-env":
    case "local-test":
    case "coston2":
    case "songbird":
    case "flare":
      return 100;
    default:
      // Ensure exhaustive checking

      ((_: never): void => {})(network);
  }
};

// Protocol id for FTSO2
export const FTSO2_PROTOCOL_ID = ftso2ProtocolId();

const epochSettings = () => {
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "from-env":
      return new EpochSettings(
        Number(process.env.ES_FIRST_VOTING_ROUND_START_TS),
        Number(process.env.ES_VOTING_EPOCH_DURATION_SECONDS),
        Number(process.env.ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID),
        Number(process.env.ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS),
        Number(process.env.FTSO_REVEAL_DEADLINE_SECONDS)
      );
    case "coston":
      return new EpochSettings(
        1658429955, // ES_FIRST_VOTING_ROUND_START_TS
        90, //ES_VOTING_EPOCH_DURATION_SECONDS
        0, //ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID
        240, //ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS
        45 //FTSO_REVEAL_DEADLINE_SECONDS
      );
    case "coston2":
      return new EpochSettings(
        1658430000, // ES_FIRST_VOTING_ROUND_START_TS
        90, //ES_VOTING_EPOCH_DURATION_SECONDS
        0, //ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID
        240, //ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS
        45 //FTSO_REVEAL_DEADLINE_SECONDS
      );
    case "songbird":
      return new EpochSettings(
        1658429955, // ES_FIRST_VOTING_ROUND_START_TS
        90, //ES_VOTING_EPOCH_DURATION_SECONDS
        0, //ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID
        3360, //ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS
        45 //FTSO_REVEAL_DEADLINE_SECONDS
      );
    case "flare":
      return new EpochSettings(
        1658430000, // ES_FIRST_VOTING_ROUND_START_TS
        90, //ES_VOTING_EPOCH_DURATION_SECONDS
        0, //ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID
        3360, //ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS
        45 //FTSO_REVEAL_DEADLINE_SECONDS
      );
    case "local-test":
      return new EpochSettings(
        1707110090, // ES_FIRST_VOTING_ROUND_START_TS
        20, //ES_VOTING_EPOCH_DURATION_SECONDS
        1000, //ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID
        5, //ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS
        10 //FTSO_REVEAL_DEADLINE_SECONDS
      );
    default:
      // Ensure exhaustive checking

      ((_: never): void => {})(network);
  }
};

const constantEpochSettings = epochSettings();

export const EPOCH_SETTINGS = () => {
  const network = process.env.NETWORK as networks;
  if (network === "from-env") {
    return epochSettings();
  }
  return constantEpochSettings;
};

const randomGenerationBenchingWindow = () => {
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "from-env": {
      if (!process.env.RANDOM_GENERATION_BENCHING_WINDOW) {
        throw new Error("RANDOM_GENERATION_BENCHING_WINDOW value is not provided");
      }
      try {
        const num = parseInt(process.env.RANDOM_GENERATION_BENCHING_WINDOW);
        if (num >= 0) {
          return num;
        }
        throw new Error("RANDOM_GENERATION_BENCHING_WINDOW must be a non negative integer");
      } catch {
        throw new Error("RANDOM_GENERATION_BENCHING_WINDOW must be an integer");
      }
    }
    case "local-test":
      return 20;
    case "coston":
      return 20;
    case "coston2":
      return 20;
    case "songbird":
      return 20;
    case "flare":
      return 20;
    default:
      // Ensure exhaustive checking

      ((_: never): void => {})(network);
  }
};

const constantRandomGenerationBenchingWindow = randomGenerationBenchingWindow();

export const RANDOM_GENERATION_BENCHING_WINDOW = () => {
  if (process.env.NETWORK === "from-env") {
    return randomGenerationBenchingWindow();
  }
  return constantRandomGenerationBenchingWindow;
};

const initialRewardEpochId = () => {
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "from-env": {
      if (!process.env.INITIAL_REWARD_EPOCH_ID) {
        throw new Error("INITIAL_REWARD_EPOCH_ID value is not provided");
      }
      return parseInt(process.env.INITIAL_REWARD_EPOCH_ID);
    }
    case "coston":
      return 2466;
    case "coston2":
      return 3110;
    case "songbird":
      return 183;
    case "flare":
      return 223;
    case "local-test":
      return 0;
    default:
      // Ensure exhaustive checking

      ((_: never): void => {})(network);
  }
};

export const INITIAL_REWARD_EPOCH_ID = initialRewardEpochId();

export const GENESIS_REWARD_EPOCH_START_EVENT = () => {
  const result: RewardEpochStarted = {
    rewardEpochId: INITIAL_REWARD_EPOCH_ID,
    timestamp: EPOCH_SETTINGS().expectedRewardEpochStartTimeSec(INITIAL_REWARD_EPOCH_ID),
    startVotingRoundId: EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(INITIAL_REWARD_EPOCH_ID),
  };
  return result;
};

// ---------------------------------------------------------------------------------------------------------------------
// FIP.16 — unification of vote power onto signing weight (stake + delegation), with P-chain stake counted 5x.
// See `docs/migrations/FIP-16-signing-weight-unification.md` for the full analysis.
//
// The reward calculator reproduces historical reward epochs, and the data provider service computes the live median.
// Both must therefore switch behaviour at the EXACT reward epoch in which the matching on-chain FlareSystemsCalculator
// change takes effect. Until those epoch ids are known they are set to a sentinel far in the future, so that the code
// reproduces the pre-FIP.16 behaviour byte-for-byte. Data providers are expected to run a version of the code in which
// this constant has been set to the correct value for the network.
// ---------------------------------------------------------------------------------------------------------------------

// Sentinel meaning "not activated yet". Any realistic reward epoch id is far below this value.
export const FIP16_NOT_ACTIVATED = Number.MAX_SAFE_INTEGER;

// Multiplier applied to P-chain stake relative to C-chain WFLR power in the delegation-vs-stake reward split.
// FIP.16 sets this initially to 5; it is subject to future governance adjustment.
export const FIP16_STAKE_WEIGHT_MULTIPLIER = 5n;

function activationRewardEpochFromEnv(): number {
  const rawValue = process.env.FIP16_ACTIVATION_REWARD_EPOCH;
  if (rawValue === undefined || rawValue.trim() === "") {
    return FIP16_NOT_ACTIVATED;
  }

  const value = rawValue.trim();
  if (!/^\d+$/.test(value)) {
    throw new Error("FIP16_ACTIVATION_REWARD_EPOCH must be a non-negative safe integer");
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("FIP16_ACTIVATION_REWARD_EPOCH must be a non-negative safe integer");
  }
  return parsed;
}

const fip16ActivationRewardEpoch = (): number => {
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "from-env": {
      return activationRewardEpochFromEnv();
    }
    case "flare":
      // FIP.16 activates on Flare with reward epoch 417 (starts 2026-07-20 07:00:00 UTC). Must match the
      // reward epoch whose on-chain signing policy is the first computed with the 5x stake weight.
      return 417;
    case "songbird":
      // FIP.16 activates on Songbird with reward epoch 417. Songbird has no P-chain staking, so the stake-weighting
      // (5x) is inert (staked weight is always 0) and no FDC->FIRE split applies (0 bips); this epoch is purely the
      // client-side rollout coordination point at which the FTSO median switches to the normalized signing weight.
      // All Songbird providers must upgrade before this epoch.
      return 417;
    // TODO(FIP.16): set the activation reward epoch ids once the on-chain deployment epochs are known.
    case "coston":
      return FIP16_NOT_ACTIVATED;
    case "coston2":
      return FIP16_NOT_ACTIVATED;
    case "local-test":
      return FIP16_NOT_ACTIVATED;
    default:
      // Ensure exhaustive checking
      ((_: never): void => {})(network);
  }
};

const constantFip16ActivationRewardEpoch = fip16ActivationRewardEpoch();

/**
 * The first reward epoch id (inclusive) in which FIP.16 vote-power unification is in effect for the current network.
 */
export const FIP16_ACTIVATION_REWARD_EPOCH = (): number => {
  if (process.env.NETWORK === "from-env") {
    return fip16ActivationRewardEpoch();
  }
  return constantFip16ActivationRewardEpoch;
};

/**
 * Whether FIP.16 vote-power unification (median on signing weight, stake counted 5x in reward distribution) applies
 * to the given reward epoch.
 */
export const isFip16Active = (rewardEpochId: number): boolean => {
  return rewardEpochId >= FIP16_ACTIVATION_REWARD_EPOCH();
};

/**
 * Weight multiplier applied to P-chain stake in the delegation-vs-stake reward distribution split for the given reward
 * epoch. Returns {@link FIP16_STAKE_WEIGHT_MULTIPLIER} once FIP.16 is active, otherwise 1 (legacy 1:1 behaviour).
 */
export const stakeWeightMultiplier = (rewardEpochId: number): bigint => {
  return isFip16Active(rewardEpochId) ? FIP16_STAKE_WEIGHT_MULTIPLIER : 1n;
};

// ---------------------------------------------------------------------------------------------------------------------
// Relay v2 — source bound signature digests
// ---------------------------------------------------------------------------------------------------------------------
// The Relay contract deployed with a `sourceChainId` verifies `keccak256(chainId ‖ message)` instead of
// `keccak256(message)`. A voter signs one digest per voting round, so a round is signed for and finalized on exactly
// one of the two contracts and reward calculation has to grade each epoch with the digest that was in force for it.
// ---------------------------------------------------------------------------------------------------------------------

/** Sentinel meaning "not activated". Any realistic reward epoch id is far below it. */
export const RELAY_V2_NOT_ACTIVATED = Number.MAX_SAFE_INTEGER;

/** The chain id bound into the digests Relay v2 verifies. */
export const CHAIN_ID = (): number => {
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "flare":
      return 14;
    case "songbird":
      return 19;
    case "coston":
      return 16;
    case "coston2":
      return 114;
    case "from-env":
    case "local-test": {
      const rawValue = process.env.CHAIN_ID?.trim();
      if (rawValue === undefined || rawValue === "") {
        throw new Error("CHAIN_ID value is not provided");
      }
      if (!/^\d+$/.test(rawValue)) {
        throw new Error("CHAIN_ID must be a non-negative integer");
      }
      return Number(rawValue);
    }
    default:
      // Ensure exhaustive checking
      ((_: never): void => {})(network);
  }
};

/** The first reward epoch whose signatures Relay v2 verifies, and whose finalizations it receives. */
export const RELAY_V2_ACTIVATION_REWARD_EPOCH = (): number => {
  const network = process.env.NETWORK as networks;
  switch (network) {
    // TODO(relay-v2): set once the cutover epochs are scheduled.
    case "flare":
    case "songbird":
    case "coston":
    case "coston2":
      return RELAY_V2_NOT_ACTIVATED;
    case "from-env":
    case "local-test": {
      const rawValue = process.env.RELAY_V2_ACTIVATION_REWARD_EPOCH?.trim();
      if (rawValue === undefined || rawValue === "") {
        return RELAY_V2_NOT_ACTIVATED;
      }
      if (!/^\d+$/.test(rawValue) || !Number.isSafeInteger(Number(rawValue))) {
        throw new Error("RELAY_V2_ACTIVATION_REWARD_EPOCH must be a non-negative safe integer");
      }
      return Number(rawValue);
    }
    default:
      // Ensure exhaustive checking
      ((_: never): void => {})(network);
  }
};

/**
 * The chain id to bind into the digests of the given reward epoch, or undefined for epochs signed before Relay v2,
 * whose digests are not source bound.
 */
export const sourceChainIdForRewardEpoch = (rewardEpochId: number): number | undefined => {
  return rewardEpochId >= RELAY_V2_ACTIVATION_REWARD_EPOCH() ? CHAIN_ID() : undefined;
};
