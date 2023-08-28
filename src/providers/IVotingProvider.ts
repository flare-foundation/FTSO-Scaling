import { ContractAddresses } from "../../deployment/tasks/common";
import {
  BareSignature,
  BlockData,
  ClaimReward,
  EpochData,
  EpochResult,
  Offer,
  VoterWithWeight,
} from "../voting-interfaces";

/**
 * The role of a Voting provider is to provide a generic interface to blockchain calls needed by the FTSO providers
 * hence abstracting away specifics of the blockchain interacting implementation and wallet usage.
 */
export interface IVotingProvider {
  get contractAddresses(): ContractAddresses;

  get firstEpochStartSec(): number;
  get epochDurationSec(): number;
  get firstRewardedPriceEpoch(): number;
  get rewardEpochDurationInEpochs(): number;
  get signingDurationSec(): number;

  get senderAddressLowercase(): string;

  thresholdForRewardEpoch(epochId: number): Promise<BN>;

  ////////////// Contract calls //////////////
  claimReward(claim: ClaimReward): Promise<any>;
  offerRewards(offer: Offer[]): Promise<any>;
  commit(hash: string): Promise<any>;
  revealBitvote(epochData: EpochData): Promise<any>;
  signResult(epochId: number, merkleRoot: string, signature: BareSignature): Promise<any>;
  finalize(epochId: number, mySignatureHash: string, signatures: BareSignature[]): Promise<boolean>;
  publishPrices(epochResult: EpochResult, symbolIndices: number[]): Promise<any>;
  allVotersWithWeightsForRewardEpoch(rewardEpoch: number): Promise<VoterWithWeight[]>;
  registerAsVoter(rewardEpochId: number, weight: number): Promise<any>;
  getMerkleRoot(epochId: number): Promise<string>;

  ////////////// Signing //////////////
  signMessage(message: string): BareSignature;
  recoverSigner(message: string, signature: BareSignature): string;

  ////////////// Block calls //////////////
  getBlockNumber(): Promise<number>;
  getBlock(blockNumber: number): Promise<BlockData>;
}
