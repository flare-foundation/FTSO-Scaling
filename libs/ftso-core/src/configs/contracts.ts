

export type ContractAddress = string;

interface FlareSystemManagerDefinition {
  name: "FlareSystemManager";
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
interface FlareSystemCalculatorDefinition {
  name: "FlareSystemCalculator";
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

export type ContractDefinitions = FlareSystemManagerDefinition |
  FtsoRewardOffersManagerDefinition |
  RewardManagerDefinition |
  SubmissionDefinition |
  RelayDefinition |
  FlareSystemCalculatorDefinition |
  VoterRegistryDefinition |
  ProtocolMerkleStructsDefinition;

export enum ContractMethodNames {
  submit1 = "submit1",
  submit2 = "submit2",
  submit3 = "submit3",
  submitSignatures = "submitSignatures",
  relay = "relay",

  // Struct definitions helper methods (to extract abis)
  // FTSO merkle tree node definitions
  feedStruct = "feedStruct",
  randomStruct = "randomStruct",
  feedWithProofStruct = "feedWithProofStruct",

  // Rewarding definitions
  rewardClaimStruct = "rewardClaimStruct",
  rewardClaimWithProofStruct = "rewardClaimWithProofStruct"
}

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
