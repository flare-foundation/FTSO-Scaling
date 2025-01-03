export type ContractAddress = string;

interface FlareSystemsManagerDefinition {
  name: "FlareSystemsManager";
  address: ContractAddress;
}
interface FtsoRewardOffersManagerDefinition {
  name: "FtsoRewardOffersManager";
  address: ContractAddress;
}
interface RewardManagerDefinition {
  name: "RewardManager";
  address: ContractAddress;
}
interface SubmissionDefinition {
  name: "Submission";
  address: ContractAddress;
}
interface RelayDefinition {
  name: "Relay";
  address: ContractAddress;
}
interface FlareSystemsCalculatorDefinition {
  name: "FlareSystemsCalculator";
  address: ContractAddress;
}
interface VoterRegistryDefinition {
  name: "VoterRegistry";
  address: ContractAddress;
}
interface FtsoMerkleStructsDefinition {
  name: "FtsoMerkleStructs";
  address: ContractAddress;
}
interface ProtocolMerkleStructsDefinition {
  name: "ProtocolMerkleStructs";
  address: ContractAddress;
}
interface FastUpdaterDefinition {
  name: "FastUpdater";
  address: ContractAddress;
}
interface FastUpdateIncentiveManagerDefinition {
  name: "FastUpdateIncentiveManager";
  address: ContractAddress;
}

interface FdcHubDefinition {
  name: "FdcHub";
  address: ContractAddress;
}

export type ContractDefinitions =
  | FlareSystemsManagerDefinition
  | FtsoRewardOffersManagerDefinition
  | RewardManagerDefinition
  | SubmissionDefinition
  | RelayDefinition
  | FlareSystemsCalculatorDefinition
  | VoterRegistryDefinition
  | ProtocolMerkleStructsDefinition
  | FtsoMerkleStructsDefinition
  | FastUpdaterDefinition
  | FastUpdateIncentiveManagerDefinition
  | FdcHubDefinition;

export type ContractDefinitionsNames =
  | FlareSystemsManagerDefinition["name"]
  | FtsoRewardOffersManagerDefinition["name"]
  | RewardManagerDefinition["name"]
  | SubmissionDefinition["name"]
  | RelayDefinition["name"]
  | FlareSystemsCalculatorDefinition["name"]
  | VoterRegistryDefinition["name"]
  | ProtocolMerkleStructsDefinition["name"]
  | FtsoMerkleStructsDefinition["name"]
  | FastUpdaterDefinition["name"]
  | FastUpdateIncentiveManagerDefinition["name"]
  | FdcHubDefinition["name"];

export enum ContractMethodNames {
  submit1 = "submit1",
  submit2 = "submit2",
  submit3 = "submit3",
  submitSignatures = "submitSignatures",
  relay = "relay",
  signUptimeVote = "signUptimeVote",
  signRewards = "signRewards",

  // Struct definitions helper methods (to extract abis)
  // FTSO merkle tree node definitions
  feedStruct = "feedStruct",
  randomStruct = "randomStruct",
  feedWithProofStruct = "feedWithProofStruct",

  // Rewarding definitions
  rewardClaimStruct = "rewardClaimStruct",
  rewardClaimWithProofStruct = "rewardClaimWithProofStruct",
}

export interface NetworkContractAddresses {
  FlareSystemsManager: FlareSystemsManagerDefinition;
  FtsoRewardOffersManager: FtsoRewardOffersManagerDefinition;
  RewardManager: RewardManagerDefinition;
  Submission: SubmissionDefinition;
  Relay: RelayDefinition;
  FlareSystemsCalculator: FlareSystemsCalculatorDefinition;
  VoterRegistry: VoterRegistryDefinition;
  FtsoMerkleStructs: FtsoMerkleStructsDefinition;
  ProtocolMerkleStructs: ProtocolMerkleStructsDefinition;
  FastUpdater: FastUpdaterDefinition;
  FastUpdateIncentiveManager: FastUpdateIncentiveManagerDefinition;
  FdcHub: FdcHubDefinition;
}
