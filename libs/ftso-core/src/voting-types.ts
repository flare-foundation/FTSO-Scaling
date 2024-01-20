import BN from "bn.js";
import { Log } from "web3-core";
import { Bytes32 } from "./utils/sol-types";
import { ValueWithDecimals } from "./utils/FeedEncoder";

export type Address = string;
export type Bytes20 = string;
export type VotingEpochId = number;
export type RewardEpochId = number;


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

export interface RevealData {
  readonly random: string;
  readonly encodedPrices: string; // 4-byte hex strings
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

export interface TxData {
  readonly blockNumber: number;
  readonly hash: string;
  readonly input: string;
  readonly from: string;
  /** Will be `null` for contract creation transactions. */
  readonly to: string | null;
  readonly status: boolean;
  readonly logs?: Log[];
}

export interface BlockData {
  readonly number: number;
  readonly timestamp: number;
  readonly transactions: readonly TxData[];
}

export interface EpochResult {
  readonly priceEpochId: number;
  readonly medianData: readonly MedianCalculationResult[];
  readonly random: Bytes32;
  readonly randomQuality: boolean;
  readonly encodedBulkPrices: string;
  readonly encodedBulkSymbols: string;
  readonly randomMessage: string;
  readonly encodedBulkPricesWithSymbols: string;
  readonly bulkPriceProof: readonly Bytes32[];
  readonly merkleRoot: Bytes32;
}

export interface MedianCalculationResult {
  readonly feed: Feed;
  readonly voters: readonly string[];
  readonly feedValues: readonly ValueWithDecimals[];
  readonly data: MedianCalculationSummary;
  readonly weights: readonly bigint[];
}

export interface RandomCalculationResult {
  readonly random: bigint
  readonly isSafe: boolean;
}

export interface MedianCalculationSummary {
  readonly finalMedianPrice: ValueWithDecimals;
  readonly quartile1Price: ValueWithDecimals;
  readonly quartile3Price: ValueWithDecimals;
}

export interface VoterRewarding {
  readonly voterAddress: string;
  weight: BN;
  readonly originalWeight: BN;
  readonly pct: boolean; // gets PCT reward
  readonly iqr: boolean; // gets IQR reward
  readonly eligible: boolean; // is eligible for reward
}

export interface RevealResult {
  readonly revealers: Address[];
  readonly committedFailedReveal: Address[];
  readonly revealedRandoms: Bytes32[];
  readonly reveals: Map<Address, RevealData>;
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