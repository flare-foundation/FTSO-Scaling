import { readFileSync } from "fs";
import { ContractAddresses } from "../../deployment/tasks/common";
import {
  BareSignature,
  BlockData,
  ClaimReward,
  EpochData,
  EpochResult,
  Offer,
  RewardOffered,
  RevealBitvoteData,
  SignatureData,
  TxData,
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

  ////////////// Contract calls //////////////
  claimReward(claim: ClaimReward): Promise<any>;
  offerRewards(offer: Offer[]): Promise<any>;
  commit(hash: string): Promise<any>;
  revealBitvote(epochData: EpochData): Promise<any>;
  signResult(epochId: number, merkleRoot: string, signature: BareSignature): Promise<any>;
  finalize(epochId: number, mySignatureHash: string, signatures: BareSignature[]): Promise<any>;
  publishPrices(epochResult: EpochResult, symbolIndices: number[]): Promise<any>;
  allVotersWithWeightsForRewardEpoch(rewardEpoch: number): Promise<VoterWithWeight[]>;
  registerAsVoter(rewardEpochId: number, weight: number): Promise<any>;

  ////////////// Signing //////////////
  signMessage(message: string): Promise<BareSignature>;

  ////////////// Block calls //////////////
  getBlockNumber(): Promise<number>;
  getBlock(blockNumber: number): Promise<BlockData>;
  getTransactionReceipt(txId: string): Promise<any>;
  ////////////// Auxiliary //////////////
  functionSignature(name: "commit" | "revealBitvote" | "signResult" | "offerRewards"): string;
  eventSignature(name: "RewardOffered"): string;
  abiForName(name: string): any;

  ////////////// Transaction and event data extraction methods //////////////

  extractOffers(tx: TxData): RewardOffered[];
  extractCommitHash(tx: TxData): string;
  extractRevealBitvoteData(tx: TxData): RevealBitvoteData;
  extractSignatureData(tx: TxData): SignatureData;
}
