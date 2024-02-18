import { RewardEpochStarted } from "../events";
import { EpochSettings } from "../utils/EpochSettings";
import { isValidContractAddress } from "../utils/voting-utils";
import { NetworkContractAddresses } from "./contracts";

const TEST_CONFIG: NetworkContractAddresses = {
  FlareSystemsManager: { name: "FlareSystemsManager", address: "0xa4bcDF64Cdd5451b6ac3743B414124A6299B65FF" },
  FtsoRewardOffersManager: { name: "FtsoRewardOffersManager", address: "0x8456161947DFc1fC159A0B26c025cD2b4bba0c3e" },
  RewardManager: { name: "RewardManager", address: "0x22474D350EC2dA53D717E30b96e9a2B7628Ede5b" },
  Submission: { name: "Submission", address: "0x18b9306737eaf6E8FC8e737F488a1AE077b18053" },
  Relay: { name: "Relay", address: "0x5A0773Ff307Bf7C71a832dBB5312237fD3437f9F" },
  FlareSystemsCalculator: { name: "FlareSystemsCalculator", address: "0x58F132FBB86E21545A4Bace3C19f1C05d86d7A22" },
  VoterRegistry: { name: "VoterRegistry", address: "0xB00cC45B4a7d3e1FEE684cFc4417998A1c183e6d" },
  FtsoMerkleStructs: { name: "FtsoMerkleStructs", address: "" },
  ProtocolMerkleStructs: { name: "ProtocolMerkleStructs", address: "" },
};

type networks = "local-test" | "from-env" | "coston2";

const configs = () => {
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "local-test":
    case "coston2":
      return TEST_CONFIG;
    case "from-env": {
      console.log(
        `Loading contract addresses from environment variables, as specified in .env NETWORK: ${process.env.NETWORK}`
      );
      if (
        !process.env.FTSO_CA_FTSO_SYSTEMS_MANAGER_ADDRESS ||
        !isValidContractAddress(process.env.FTSO_CA_FTSO_SYSTEMS_MANAGER_ADDRESS)
      )
        throw new Error("FTSO_CA_FTSO_SYSTEMS_MANAGER_ADDRESS value is not valid contract address");
      if (
        !process.env.FTSO_CA_FTSO_REWARD_OFFERS_MANAGER_ADDRESS ||
        !isValidContractAddress(process.env.FTSO_CA_FTSO_REWARD_OFFERS_MANAGER_ADDRESS)
      )
        throw new Error("FTSO_CA_FTSO_REWARD_OFFERS_MANAGER_ADDRESS value is not valid contract address");
      if (
        !process.env.FTSO_CA_REWARD_MANAGER_ADDRESS ||
        !isValidContractAddress(process.env.FTSO_CA_REWARD_MANAGER_ADDRESS)
      )
        throw new Error("FTSO_CA_REWARD_MANAGER_ADDRESS value is not valid contract address");
      if (!process.env.FTSO_CA_SUBMISSION_ADDRESS || !isValidContractAddress(process.env.FTSO_CA_SUBMISSION_ADDRESS))
        throw new Error("FTSO_CA_SUBMISSION_ADDRESS value is not valid contract address");
      if (!process.env.FTSO_CA_RELAY_ADDRESS || !isValidContractAddress(process.env.FTSO_CA_RELAY_ADDRESS))
        throw new Error("FTSO_CA_RELAY_ADDRESS value is not valid contract address");
      if (
        !process.env.FTSO_CA_FLARE_SYSTEMS_CALCULATOR_ADDRESS ||
        !isValidContractAddress(process.env.FTSO_CA_FLARE_SYSTEMS_CALCULATOR_ADDRESS)
      )
        throw new Error("FTSO_CA_FLARE_SYSTEMS_CALCULATOR_ADDRESS value is not valid contract address");
      if (
        !process.env.FTSO_CA_VOTER_REGISTRY_ADDRESS ||
        !isValidContractAddress(process.env.FTSO_CA_VOTER_REGISTRY_ADDRESS)
      )
        throw new Error("FTSO_CA_VOTER_REGISTRY_ADDRESS value is not valid contract address");
      const CONTRACT_CONFIG: NetworkContractAddresses = {
        FlareSystemsManager: { name: "FlareSystemsManager", address: process.env.FTSO_CA_FTSO_SYSTEMS_MANAGER_ADDRESS },
        FtsoRewardOffersManager: {
          name: "FtsoRewardOffersManager",
          address: process.env.FTSO_CA_FTSO_REWARD_OFFERS_MANAGER_ADDRESS,
        },
        RewardManager: { name: "RewardManager", address: process.env.FTSO_CA_REWARD_MANAGER_ADDRESS },
        Submission: { name: "Submission", address: process.env.FTSO_CA_SUBMISSION_ADDRESS },
        Relay: { name: "Relay", address: process.env.FTSO_CA_RELAY_ADDRESS },
        FlareSystemsCalculator: {
          name: "FlareSystemsCalculator",
          address: process.env.FTSO_CA_FLARE_SYSTEMS_CALCULATOR_ADDRESS,
        },
        VoterRegistry: { name: "VoterRegistry", address: process.env.FTSO_CA_VOTER_REGISTRY_ADDRESS },
        FtsoMerkleStructs: { name: "FtsoMerkleStructs", address: "" },
        ProtocolMerkleStructs: { name: "ProtocolMerkleStructs", address: "" },
      };
      return CONTRACT_CONFIG;
    }
    default:
      // Ensure exhaustive checking
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => {})(network);
  }
};

export const CONTRACTS = configs();

export const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// State names in indexer database
export const LAST_CHAIN_INDEX_STATE = "last_chain_block";
export const LAST_DATABASE_INDEX_STATE = "last_database_block";
export const FIRST_DATABASE_INDEX_STATE = "first_database_block";

const ftso2ProtocolId = () => {
  switch (process.env.NETWORK) {
    case "local-test":
    default:
      return 100;
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
    case "coston2":
    case "local-test":
    default:
      return new EpochSettings(
        1707110090, // ES_FIRST_VOTING_ROUND_START_TS
        20, //ES_VOTING_EPOCH_DURATION_SECONDS
        1000, //ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID
        5, //ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS
        10 //FTSO_REVEAL_DEADLINE_SECONDS
      );
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
  switch (process.env.NETWORK) {
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
    default:
      return 50;
  }
};

const constantRandomGenerationBenchingWindow = randomGenerationBenchingWindow();

export const RANDOM_GENERATION_BENCHING_WINDOW = () => {
  if (process.env.NETWORK === "from-env") {
    return randomGenerationBenchingWindow();
  }
  return constantRandomGenerationBenchingWindow;
};

const burnAddress = () => {
  switch (process.env.NETWORK) {
    case "local-test":
    default:
      return "0x000000000000000000000000000000000000dEaD";
  }
};

export const BURN_ADDRESS = burnAddress();

/**
 * The number of additional voting rounds for performing queries for signature and finalization data.
 * If value is 0, then for votingRoundId the original window is from the end of reveals to the end
 * of the voting epoch votingRoundId. If value is bigger, it extends to ends of the next epochs accordingly.
 */
const additionalRewardFinalizationWindows = () => {
  switch (process.env.NETWORK) {
    case "local-test":
    default:
      return 0;
  }
};

export const ADDITIONAL_REWARDED_FINALIZATION_WINDOWS = additionalRewardFinalizationWindows();

export const GENESIS_REWARD_EPOCH_START_EVENT = () => {
  const result: RewardEpochStarted = {
    rewardEpochId: 0,
    timestamp: EPOCH_SETTINGS().expectedRewardEpochStartTimeSec(0),
    startVotingRoundId: EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(0),
  };
  return result;
};

/////////////// REWARDING CONSTANTS ////////////////////

function extractIntegerNonNegativeValueFromEnv(envVar: string): number {
  if (!process.env[envVar]) {
    throw new Error(`${envVar} value is not provided`);
  }
  try {
    const num = parseInt(process.env[envVar]);
    if (num >= 0) {
      return num;
    }
    throw new Error(`${envVar} must be a non negative integer`);
  } catch {
    throw new Error(`${envVar} must be an integer`);
  }
}

function extractBigIntNonNegativeValueFromEnv(envVar: string): bigint {
  if (!process.env[envVar]) {
    throw new Error(`${envVar} value is not provided`);
  }
  try {
    const num = BigInt(process.env[envVar]);
    if (num >= 0) {
      return num;
    }
    throw new Error(`${envVar} must be a non negative integer`);
  } catch {
    throw new Error(`${envVar} must be an integer`);
  }
}

/**
 * Penalty factor for reveal withdrawal. Given a weight relative share of a partial reward offer's amount
 * the value is multiplied by this factor to get the penalty amount.
 */
const penaltyFactor = () => {
  switch (process.env.NETWORK) {
    case "from-env":
      return extractBigIntNonNegativeValueFromEnv("PENALTY_FACTOR");
    case "local-test":
    default:
      return 30n;
  }
};

const constantPenaltyFactor = penaltyFactor();

export const PENALTY_FACTOR = () => {
  if (process.env.NETWORK === "from-env") {
    return penaltyFactor();
  }
  return constantPenaltyFactor;
};

/**
 * Grace period for signature submission starts immediately after the reveal deadline and lasts for this duration.
 * In this period signatures by voters are rewarded even if finalization comes earlier. Namely,
 * the signatures are rewarded if they are deposited before the timestamp of the first successful finalization.
 */
const gracePeriodForSignaturesDurationSec = () => {
  switch (process.env.NETWORK) {
    case "from-env":
      return extractIntegerNonNegativeValueFromEnv("GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC");
    case "local-test":
    default:
      return 10; // 10 seconds
  }
};

const constantGracePeriodForSignaturesDurationSec = gracePeriodForSignaturesDurationSec();

export const GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC = () => {
  if (process.env.NETWORK === "from-env") {
    return gracePeriodForSignaturesDurationSec();
  }
  return constantGracePeriodForSignaturesDurationSec;
};

/**
 * Grace period for finalization submission starts immediately after the reveal deadline and lasts for this duration.
 * If selected voters submit or try to submit a correct finalization in this period, they are rewarded.
 * Selection of voters is done pseudo-randomly based on the hash of the voting round id and the protocol id.
 * See class RandomVoterSelector for more details.
 */

const gracePeriodForFinalizationDurationSec = () => {
  switch (process.env.NETWORK) {
    case "from-env":
      return extractIntegerNonNegativeValueFromEnv("GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC");
    case "local-test":
    default:
      return 20; // seconds
  }
};

const constantGracePeriodForFinalizationDurationSec = gracePeriodForFinalizationDurationSec();

export const GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC = () => {
  if (process.env.NETWORK === "from-env") {
    return gracePeriodForFinalizationDurationSec();
  }
  return constantGracePeriodForFinalizationDurationSec;
};

/**
 * Price epoch reward offers are divided into three parts:
 * - 10% for finalizers
 * - 10% for signers
 * - 80%  + remainder for the median calculation results.
 * The constants below define the percentage of the reward that is distributed to the finalizers and signers.
 */
export const SIGNING_BIPS = () => 1000n;
export const FINALIZATION_BIPS = () => 1000n;

/**
 * BIPS and PPM total values.
 */
export const TOTAL_BIPS = 10000n;
export const TOTAL_PPM = 1000000n;

/**
 * In case less then certain percentage of the total weight of the voting weight deposits signatures for a single hash,
 * in the signature rewarding window, the signatures are not rewarded.
 * In case that exactly the same weight is deposited in the signature rewarding window, for multiple hashes (e.g. 2 hashes),
 * both get reward.
 */
const minimalRewardedNonConsensusDepositedSignaturesPerHashBips = () => {
  switch (process.env.NETWORK) {
    case "from-env":
      return extractIntegerNonNegativeValueFromEnv("MINIMAL_REWARDED_NON_CONSENSUS_DEPOSITED_SIGNATURES_PER_HASH_BIPS");
    case "local-test":
    default:
      return 3000;
  }
};

const constantMinimalRewardedNonConsensusDepositedSignaturesPerHashBips =
  minimalRewardedNonConsensusDepositedSignaturesPerHashBips();

export const MINIMAL_REWARDED_NON_CONSENSUS_DEPOSITED_SIGNATURES_PER_HASH_BIPS = () => {
  if (process.env.NETWORK === "from-env") {
    return minimalRewardedNonConsensusDepositedSignaturesPerHashBips();
  }
  return constantMinimalRewardedNonConsensusDepositedSignaturesPerHashBips;
};

/**
 * The share of weight that gets randomly selected for finalization reward.
 */
const finalizationVoterSelectionThresholdWeightBips = () => {
  switch (process.env.NETWORK) {
    case "from-env":
      return extractIntegerNonNegativeValueFromEnv("FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS");
    case "local-test":
    default:
      return 500;
  }
};

const constantFinalizationVoterSelectionThresholdWeightBips = finalizationVoterSelectionThresholdWeightBips();

export const FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS = () => {
  if (process.env.NETWORK === "from-env") {
    return finalizationVoterSelectionThresholdWeightBips();
  }
  return constantFinalizationVoterSelectionThresholdWeightBips;
};

/**
 * For signing and finalization rewards in grace period delegation fee is used.
 * In future mirrored staking fee will be used. Since a malicious voter could still have stake in the system
 * while changing the delegation fee and stakers are locked into the stake, the cap is the protection
 * against the malicious behavior.
 */
export const CAPPED_STAKING_FEE_BIPS = 2000;

export const CALCULATIONS_FOLDER = () => "calculations";
