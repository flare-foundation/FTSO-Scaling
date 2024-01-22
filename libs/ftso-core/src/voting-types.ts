import BN from "bn.js";
import { ValueWithDecimals } from "./utils/FeedEncoder";
import { MerkleTree } from "./utils/MerkleTree";

export type Address = string;
export type Bytes20 = string;
export type VotingEpochId = number;
export type RewardEpochId = number;
export type MessageHash = string;


export interface RewardClaim {
  /**
   * `true`if the claim is for the full amount claimable by the specified beneficiary. E.g: back claims, signer and finalization claims.
   * `false` if the claim is for voting rewards, where the amount is shared between the beneficiary voter and its delegators proportionally to their weights.
   */
  readonly isFixedClaim: boolean;
  readonly amount: BN; // 256-bit
  readonly currencyAddress: string;
  readonly beneficiary: string;
  readonly priceEpochId: number;
}

export interface RewardClaimWithProof {
  readonly merkleProof: readonly string[];
  readonly body: RewardClaim;
}



export interface BareSignature {
  readonly v: number;
  readonly r: string;
  readonly s: string;
}

export interface SignatureData {
  readonly epochId: number;
  readonly merkleRoot: string;
  readonly v: number;
  readonly r: string;
  readonly s: string;
}

export interface FinalizeData {
  readonly confirmed: boolean;
  readonly from: string;
  readonly epochId: number;
  readonly merkleRoot: string;
  readonly signatures: readonly BareSignature[];
}

export interface EpochResult {
  readonly votingRoundId: number;
  readonly medianData: MedianCalculationResult[];
  readonly randomData: RandomCalculationResult;
  readonly merkleTree: MerkleTree;
}

export interface MedianCalculationResult {
  readonly votingRoundId: number;
  readonly feed: Feed;
  readonly voters: readonly string[];
  readonly feedValues: readonly ValueWithDecimals[];
  readonly data: MedianCalculationSummary;
  readonly weights: readonly bigint[];
  readonly totalVotingWeight: bigint;
}

export interface RandomCalculationResult {
  readonly votingRoundId: number;
  readonly random: bigint
  readonly isSecure: boolean;
}

export interface MedianCalculationSummary {
  readonly finalMedianPrice: ValueWithDecimals;
  readonly quartile1Price: ValueWithDecimals;
  readonly quartile3Price: ValueWithDecimals;
  readonly participatingWeight: bigint;
}

export interface VoterRewarding {
  readonly voterAddress: string;
  weight: BN;
  readonly originalWeight: BN;
  readonly pct: boolean; // gets PCT reward
  readonly iqr: boolean; // gets IQR reward
  readonly eligible: boolean; // is eligible for reward
}

/**
 * Reward offers 
 * Defined in FtsoRewardOffersManager.sol
 */

export interface Feed {
  /**
   *  8 characters/bytes or 16 hex chars (18 if 0x prefix)
   */
  name: string;
  /**
   * int8 (solidity int8) the number of decimals in the price.
   */
  decimals: number; 
}

/**
 * Median merkle tree items.
 */

/**
 * Feed item that goes into the merkle tree.
 */
interface FeedTreeNode {
  votingRoundId: number;
  feed: Feed;
  value: number; // 32-bit signed integer (solidity int32)
  turnoutBIPS: number;
}

/**
 * Random item that goes into the merkle tree.
 */
interface RandomTreeNode {
  votingRoundId: number;
  random: bigint;  
}