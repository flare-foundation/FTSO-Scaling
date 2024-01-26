import { EpochSettings } from "../utils/EpochSettings";
import { Address } from "../voting-types";

interface FlareSystemManagerDefinition {
  name: "FlareSystemManager";
  address: Address;
}

interface FtsoRewardOffersManagerDefinition {
  name: "FtsoRewardOffersManager";
  address: Address;
}

interface RewardManagerDefinition {
  name: "RewardManager";
  address: Address;
}

interface SubmissionDefinition {
  name: "Submission";
  address: Address;
}

interface RelayDefinition {
  name: "Relay";
  address: Address;
}

interface FlareSystemCalculatorDefinition {
  name: "FlareSystemCalculator";
  address: Address;
}

interface VoterRegistryDefinition {
  name: "VoterRegistry";
  address: Address;
}

interface FtsoMerkleStructsDefinition {
  name: "FtsoMerkleStructs";
  address: Address;
}

interface ProtocolMerkleStructsDefinition {
  name: "ProtocolMerkleStructs";
  address: Address;
}

export type ContractDefinitions =
  | FlareSystemManagerDefinition
  | FtsoRewardOffersManagerDefinition
  | RewardManagerDefinition
  | SubmissionDefinition
  | RelayDefinition
  | FlareSystemCalculatorDefinition
  | VoterRegistryDefinition
  | ProtocolMerkleStructsDefinition;

export interface NetworkContractAddresses {
  FlareSystemManager: FlareSystemManagerDefinition;
  FtsoRewardOffersManager: FtsoRewardOffersManagerDefinition;
  RewardManager: RewardManagerDefinition;
  Submission: SubmissionDefinition;
  Relay: RelayDefinition;
  FlareSystemCalculator: FlareSystemCalculatorDefinition;
  VoterRegistry: VoterRegistryDefinition;
  FtsoMerkleStructs: FtsoMerkleStructsDefinition;
  ProtocolMerkleStructs: ProtocolMerkleStructsDefinition;
}

const TEST_CONFIG: NetworkContractAddresses = {
  FlareSystemManager: { name: "FlareSystemManager", address: "0xa4bcDF64Cdd5451b6ac3743B414124A6299B65FF" },
  FtsoRewardOffersManager: { name: "FtsoRewardOffersManager", address: "0x8456161947DFc1fC159A0B26c025cD2b4bba0c3e" },
  RewardManager: { name: "RewardManager", address: "0x22474D350EC2dA53D717E30b96e9a2B7628Ede5b" },
  Submission: { name: "Submission", address: "0x18b9306737eaf6E8FC8e737F488a1AE077b18053" },
  Relay: { name: "Relay", address: "0x5A0773Ff307Bf7C71a832dBB5312237fD3437f9F" },
  FlareSystemCalculator: { name: "FlareSystemCalculator", address: "0x58F132FBB86E21545A4Bace3C19f1C05d86d7A22" },
  VoterRegistry: { name: "VoterRegistry", address: "0xB00cC45B4a7d3e1FEE684cFc4417998A1c183e6d" },
  FtsoMerkleStructs: { name: "FtsoMerkleStructs", address: "" },
  ProtocolMerkleStructs: { name: "ProtocolMerkleStructs", address: "" },
};

type networks = "local-test" | "coston2";

const configs = () => {
  switch (process.env.NETWORK) {
    case "local-test":
    default:
      return TEST_CONFIG;
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
  switch (process.env.NETWORK) {
    case "local-test":
    default:
      return new EpochSettings(
        1704250616, // ES_FIRST_VOTING_ROUND_START_TS
        20, //ES_VOTING_EPOCH_DURATION_SECONDS
        1000, //ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID
        5, //ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS
        10
      );
  }
};

export const EPOCH_SETTINGS = epochSettings();

const randomGenerationBenchingWindow = () => {
  switch (process.env.NETWORK) {
    case "local-test":
    default:
      return 100;
  }
};

export const RANDOM_GENERATION_BENCHING_WINDOW = randomGenerationBenchingWindow();

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
