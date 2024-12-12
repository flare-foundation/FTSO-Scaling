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
  FastUpdater: { name: "FastUpdater", address: "" },
  FastUpdateIncentiveManager: { name: "FastUpdateIncentiveManager", address: "" },
  FdcHub: { name: "FdcHub", address: "" },
};

const COSTON_CONFIG: NetworkContractAddresses = {
  FlareSystemsManager: { name: "FlareSystemsManager", address: "0x85680Dd93755Fe5d0789773fd0896cEE51F9e358" },
  FtsoRewardOffersManager: { name: "FtsoRewardOffersManager", address: "0xC9534cB913150aD3e98D792857689B55e2404212" },
  RewardManager: { name: "RewardManager", address: "0x2ade9972E7f27200872D378acF7a1BaD8D696FC5" },
  Submission: { name: "Submission", address: "0x2cA6571Daa15ce734Bbd0Bf27D5C9D16787fc33f" },
  Relay: { name: "Relay", address: "0x92a6E1127262106611e1e129BB64B6D8654273F7" },
  FlareSystemsCalculator: { name: "FlareSystemsCalculator", address: "0x43CBAB9C953F54533aadAf7ffCD13c30ec05Edc9" },
  VoterRegistry: { name: "VoterRegistry", address: "0xE2c06DF29d175Aa0EcfcD10134eB96f8C94448A3" },
  FtsoMerkleStructs: { name: "FtsoMerkleStructs", address: "" },
  ProtocolMerkleStructs: { name: "ProtocolMerkleStructs", address: "" },
  FastUpdater: { name: "FastUpdater", address: "0xB8336A96b4b8af89f60EA080002214191Bc8293A" },
  FastUpdateIncentiveManager: {
    name: "FastUpdateIncentiveManager",
    address: "0x8c45666369B174806E1AB78D989ddd79a3267F3b",
  },
  FdcHub: { name: "FdcHub", address: "0x1c78A073E3BD2aCa4cc327d55FB0cD4f0549B55b" },
};

const COSTON2_CONFIG: NetworkContractAddresses = {
  FlareSystemsManager: { name: "FlareSystemsManager", address: "0xA90Db6D10F856799b10ef2A77EBCbF460aC71e52" },
  FtsoRewardOffersManager: { name: "FtsoRewardOffersManager", address: "0x1b7ffab226b66b5eCBdC79a42287BC09C05bCb33" },
  RewardManager: { name: "RewardManager", address: "0xB4f43E342c5c77e6fe060c0481Fe313Ff2503454" },
  Submission: { name: "Submission", address: "0x2cA6571Daa15ce734Bbd0Bf27D5C9D16787fc33f" },
  Relay: { name: "Relay", address: "0x4087D4B5E009Af9FF41db910205439F82C3dc63c" },
  FlareSystemsCalculator: { name: "FlareSystemsCalculator", address: "0x9aF60c16192330EC98d04Ec9675d22dBb9892951" },
  VoterRegistry: { name: "VoterRegistry", address: "0xc6E40401395DCc648bC4bBb38fE4552423cD9BAC" },
  FtsoMerkleStructs: { name: "FtsoMerkleStructs", address: "" },
  ProtocolMerkleStructs: { name: "ProtocolMerkleStructs", address: "" },
  FastUpdater: { name: "FastUpdater", address: "0x0B162CA3acf3482d3357972e12d794434085D839" },
  FastUpdateIncentiveManager: {
    name: "FastUpdateIncentiveManager",
    address: "0xC71C1C6E6FB31eF6D948B2C074fA0d38a07D4f68",
  },
  FdcHub: { name: "FdcHub", address: "" },
};

const SONGBIRD_CONFIG: NetworkContractAddresses = {
  FlareSystemsManager: { name: "FlareSystemsManager", address: "0x421c69E22f48e14Fc2d2Ee3812c59bfb81c38516" },
  FtsoRewardOffersManager: { name: "FtsoRewardOffersManager", address: "0x5aB9cB258a342001C4663D9526A1c54cCcF8C545" },
  RewardManager: { name: "RewardManager", address: "0xE26AD68b17224951b5740F33926Cc438764eB9a7" },
  Submission: { name: "Submission", address: "0x2cA6571Daa15ce734Bbd0Bf27D5C9D16787fc33f" },
  Relay: { name: "Relay", address: "0x67a916E175a2aF01369294739AA60dDdE1Fad189" },
  FlareSystemsCalculator: { name: "FlareSystemsCalculator", address: "0x126FAeEc75601dA3354c0b5Cc0b60C85fCbC3A5e" },
  VoterRegistry: { name: "VoterRegistry", address: "0x31B9EC65C731c7D973a33Ef3FC83B653f540dC8D" },
  FtsoMerkleStructs: { name: "FtsoMerkleStructs", address: "" },
  ProtocolMerkleStructs: { name: "ProtocolMerkleStructs", address: "" },
  FastUpdater: { name: "FastUpdater", address: "0x7D9F73FD9bC4607daCB618FF895585f98BFDD06B" },
  FastUpdateIncentiveManager: {
    name: "FastUpdateIncentiveManager",
    address: "0x596C70Ad6fFFdb9b6158F1Dfd0bc32cc72B82006",
  },
  FdcHub: { name: "FdcHub", address: "0xCfD4669a505A70c2cE85db8A1c1d14BcDE5a1a06" },
};

const FLARE_CONFIG: NetworkContractAddresses = {
  FlareSystemsManager: { name: "FlareSystemsManager", address: "0x89e50DC0380e597ecE79c8494bAAFD84537AD0D4" },
  FtsoRewardOffersManager: { name: "FtsoRewardOffersManager", address: "0x244EA7f173895968128D5847Df2C75B1460ac685" },
  RewardManager: { name: "RewardManager", address: "0xC8f55c5aA2C752eE285Bd872855C749f4ee6239B" },
  Submission: { name: "Submission", address: "0x2cA6571Daa15ce734Bbd0Bf27D5C9D16787fc33f" },
  Relay: { name: "Relay", address: "0xea077600E3065F4FAd7161a6D0977741f2618eec" },
  FlareSystemsCalculator: { name: "FlareSystemsCalculator", address: "0x67c4B11c710D35a279A41cff5eb089Fe72748CF8" },
  VoterRegistry: { name: "VoterRegistry", address: "0x2580101692366e2f331e891180d9ffdF861Fce83" },
  FtsoMerkleStructs: { name: "FtsoMerkleStructs", address: "" },
  ProtocolMerkleStructs: { name: "ProtocolMerkleStructs", address: "" },
  FastUpdater: { name: "FastUpdater", address: "0xdBF71d7840934EB82FA10173103D4e9fd4054dd1" },
  FastUpdateIncentiveManager: {
    name: "FastUpdateIncentiveManager",
    address: "0xd648e8ACA486Ce876D641A0F53ED1F2E9eF4885D",
  },
  FdcHub: { name: "FdcHub", address: "" },
};

export type networks = "local-test" | "from-env" | "coston2" | "coston" | "songbird" | "flare";

const contracts = () => {
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "local-test":
    case "coston2":
      return COSTON2_CONFIG;
    case "coston":
      return COSTON_CONFIG;
    case "songbird":
      return SONGBIRD_CONFIG;
    case "flare":
      return FLARE_CONFIG;
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
      if (
        !process.env.FTSO_CA_FAST_UPDATER_ADDRESS ||
        !isValidContractAddress(process.env.FTSO_CA_FAST_UPDATER_ADDRESS)
      )
        throw new Error("FTSO_CA_FAST_UPDATER_ADDRESS value is not valid contract address");
      if (
        !process.env.FTSO_CA_FAST_UPDATE_INCENTIVE_MANAGER_ADDRESS ||
        !isValidContractAddress(process.env.FTSO_CA_FAST_UPDATE_INCENTIVE_MANAGER_ADDRESS)
      )
        throw new Error("FTSO_CA_FAST_UPDATE_INCENTIVE_MANAGER_ADDRESS value is not valid contract address");
      if (
        !process.env.FTSO_CA_FDC_HUB_ADDRESS ||
        !isValidContractAddress(process.env.FTSO_CA_FDC_HUB_ADDRESS)
      )
        throw new Error("FTSO_CA_FDC_HUB_ADDRESS value is not valid contract address");

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
        FastUpdater: { name: "FastUpdater", address: process.env.FTSO_CA_FAST_UPDATER_ADDRESS },
        FastUpdateIncentiveManager: {
          name: "FastUpdateIncentiveManager",
          address: process.env.FTSO_CA_FAST_UPDATE_INCENTIVE_MANAGER_ADDRESS,
        },
        FdcHub: { name: "FdcHub", address: process.env.FTSO_CA_FDC_HUB_ADDRESS },
      };
      return CONTRACT_CONFIG;
    }
    default:
      // Ensure exhaustive checking
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => { })(network);
  }
};

export const CONTRACTS = contracts();

export const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

// State names in indexer database
export const LAST_CHAIN_INDEX_STATE = "last_chain_block";
export const LAST_DATABASE_INDEX_STATE = "last_database_block";
export const FIRST_DATABASE_INDEX_STATE = "first_database_block";

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
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => { })(network);
  }
};

// Protocol id for FTSO2
export const FTSO2_PROTOCOL_ID = ftso2ProtocolId();

const ftso2FastUpdatesProtocolId = () => {
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "coston":
    case "from-env":
    case "local-test":
    case "coston2":
    case "songbird":
    case "flare":
      return 255;
    default:
      // Ensure exhaustive checking
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => { })(network);
  }
};

// Protocol id for FTSO2 fast updates
export const FTSO2_FAST_UPDATES_PROTOCOL_ID = ftso2FastUpdatesProtocolId();


const FDCProtocolId = () => {
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "coston":
    case "from-env":
    case "local-test":
    case "coston2":
    case "songbird":
    case "flare":
      return 200;
    default:
      // Ensure exhaustive checking
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => { })(network);
  }
};

// Protocol id for FDC
export const FDC_PROTOCOL_ID = FDCProtocolId();


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
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => { })(network);
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
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => { })(network);
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
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => { })(network);
  }
};

export const INITIAL_REWARD_EPOCH_ID = initialRewardEpochId();

const burnAddress = () => {
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "from-env":
    case "local-test":
    case "coston2":
    case "coston":
    case "songbird":
    case "flare":
      return "0x000000000000000000000000000000000000dEaD";
    default:
      // Ensure exhaustive checking
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => { })(network);
  }
};

export const BURN_ADDRESS = burnAddress();

/**
 * The number of additional voting rounds for performing queries for signature and finalization data.
 * If value is 0, then for votingRoundId the original window is from the end of reveals to the end
 * of the voting epoch votingRoundId. If value is bigger, it extends to ends of the next epochs accordingly.
 */
const additionalRewardFinalizationWindows = () => {
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "from-env":
    case "coston":
    case "coston2":
    case "songbird":
    case "flare":
    case "local-test":
      return 0;
    default:
      // Ensure exhaustive checking
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => { })(network);
  }
};

export const ADDITIONAL_REWARDED_FINALIZATION_WINDOWS = additionalRewardFinalizationWindows();

export const GENESIS_REWARD_EPOCH_START_EVENT = () => {
  const result: RewardEpochStarted = {
    rewardEpochId: INITIAL_REWARD_EPOCH_ID,
    timestamp: EPOCH_SETTINGS().expectedRewardEpochStartTimeSec(INITIAL_REWARD_EPOCH_ID),
    startVotingRoundId: EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(INITIAL_REWARD_EPOCH_ID),
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
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "from-env":
      return extractBigIntNonNegativeValueFromEnv("PENALTY_FACTOR");
    case "coston":
      return 30n;
    case "coston2":
      return 30n;
    case "songbird":
      return 30n;
    case "flare":
      return 30n;
    case "local-test":
      return 30n;
    default:
      // Ensure exhaustive checking
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => { })(network);
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
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "from-env":
      return extractIntegerNonNegativeValueFromEnv("GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC");
    case "coston":
      return 10; // 10 seconds
    case "coston2":
      return 10; // 10 seconds
    case "songbird":
      return 10; // 10 seconds
    case "flare":
      return 10; // 10 seconds
    case "local-test":
      return 10; // 10 seconds
    default:
      // Ensure exhaustive checking
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => { })(network);
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
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "from-env":
      return extractIntegerNonNegativeValueFromEnv("GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC");
    case "coston":
      return 20; // seconds
    case "coston2":
      return 20; // seconds
    case "songbird":
      return 20; // seconds
    case "flare":
      return 20; // 20 seconds
    case "local-test":
      return 20; // seconds
    default:
      // Ensure exhaustive checking
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => { })(network);
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
 * Voting round reward offers are divided into three parts:
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
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "from-env":
      return extractIntegerNonNegativeValueFromEnv("MINIMAL_REWARDED_NON_CONSENSUS_DEPOSITED_SIGNATURES_PER_HASH_BIPS");
    case "coston":
      return 3000;
    case "coston2":
      return 3000;
    case "songbird":
      return 3000;
    case "flare":
      return 3000;
    case "local-test":
      return 3000;
    default:
      // Ensure exhaustive checking
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => { })(network);
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
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "from-env":
      return extractIntegerNonNegativeValueFromEnv("FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS");
    case "coston":
      return 500;
    case "coston2":
      return 500;
    case "songbird":
      return 500;
    case "flare":
      return 500;
    case "local-test":
      return 500;
    default:
      // Ensure exhaustive checking
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => { })(network);
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

export const CALCULATIONS_FOLDER = () => {
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "from-env":
      return "calculations/from-env";
    case "coston":
      return "calculations/coston";
    case "coston2":
      return "calculations/coston2";
    case "songbird":
      return "calculations/songbird";
    case "flare":
      return "calculations/flare";
    case "local-test":
      return "calculations/local-test";
    default:
      // Ensure exhaustive checking
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => { })(network);
  }
};

export const FEEDS_RENAMING_FILE = () => "libs/ftso-core/src/reward-calculation/feeds-renaming.json";

export const FUTURE_VOTING_ROUNDS = () => 30;

// Used to limit querying of too old events and handling the missing event for the voting round
export const COSTON_FAST_UPDATER_SWITCH_VOTING_ROUND_ID = 779191;

// set to start voting round id of epoch 234
// on Songbird there was no missing event for the voting round
// Only used to filter out the old events
export const SONGBIRD_FAST_UPDATER_SWITCH_VOTING_ROUND_ID = 786240;

export const WRONG_SIGNATURE_INDICATOR_MESSAGE_HASH = "WRONG_SIGNATURE";

export const STAKING_DATA_BASE_FOLDER = "staking-data";

export const STAKING_DATA_FOLDER = () => {
  const network = process.env.NETWORK as networks;
  const STAKING_DATA_BASE_FOLDER = "staking-data";
  switch (network) {
    case "from-env":
      return `${STAKING_DATA_BASE_FOLDER}/from-env`;
    case "coston":
      return `${STAKING_DATA_BASE_FOLDER}/coston`;
    case "coston2":
      return `${STAKING_DATA_BASE_FOLDER}/coston2`;
    case "songbird":
      return `${STAKING_DATA_BASE_FOLDER}/songbird`;
    case "flare":
      return `${STAKING_DATA_BASE_FOLDER}/flare`;
    case "local-test":
      return `${STAKING_DATA_BASE_FOLDER}/local-test`;
    default:
      // Ensure exhaustive checking
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => { })(network);
  }
};

export const PASSES_DATA_FOLDER = () => {
  const network = process.env.NETWORK as networks;
  const PASSES_DATA_BASE_FOLDER = "passes-data";
  switch (network) {
    case "from-env":
      return `${PASSES_DATA_BASE_FOLDER}/from-env`;
    case "coston":
      return `${PASSES_DATA_BASE_FOLDER}/coston`;
    case "coston2":
      return `${PASSES_DATA_BASE_FOLDER}/coston2`;
    case "songbird":
      return `${PASSES_DATA_BASE_FOLDER}/songbird`;
    case "flare":
      return `${PASSES_DATA_BASE_FOLDER}/flare`;
    case "local-test":
      return `${PASSES_DATA_BASE_FOLDER}/local-test`;
    default:
      // Ensure exhaustive checking
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => { })(network);
  }
};