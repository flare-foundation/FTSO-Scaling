import { ContractAddresses } from "../../deployment/tasks/common";
import BN from "bn.js";
import {
  BareSignature,
  BlockData,
  RewardClaimWithProof,
  EpochData,
  EpochResult,
  Offer,
} from "../protocol/voting-types";

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

  thresholdForRewardEpoch(rewardEpochId: number): Promise<BN>;

  ////////////// Contract calls //////////////
  claimRewards(claim: RewardClaimWithProof[], beneficiary: string): Promise<any>;
  offerRewards(offer: Offer[]): Promise<any>;
  commit(hash: string): Promise<any>;
  revealBitvote(epochData: EpochData): Promise<any>;
  signResult(priceEpochId: number, merkleRoot: string, signature: BareSignature): Promise<any>;
  finalize(priceEpochId: number, mySignatureHash: string, signatures: BareSignature[]): Promise<any>;
  signRewards(rewardEpoch: number, merkleRoot: string, signature: BareSignature): Promise<any>;
  finalizeRewards(rewardEpoch: number, mySignatureHash: string, signatures: BareSignature[]): Promise<any>;
  publishPrices(epochResult: EpochResult, symbolIndices: number[]): Promise<any>;
  getVoterWeightsForRewardEpoch(rewardEpoch: number): Promise<Map<string, BN>>;
  registerAsVoter(rewardEpochId: number, weight: number): Promise<any>;
  getMerkleRoot(priceEpochId: number): Promise<string>;

  ////////////// Signing //////////////
  signMessage(message: string): Promise<BareSignature>;
  signMessageWithKey(message: string, key: string): Promise<BareSignature>;
  recoverSigner(message: string, signature: BareSignature): Promise<string>;

  ////////////// Block calls //////////////
  getBlockNumber(): Promise<number>;
  getBlock(blockNumber: number): Promise<BlockData>;
}
