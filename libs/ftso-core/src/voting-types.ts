import { ValueWithDecimals } from "./utils/FeedValueEncoder";
import { MerkleTree } from "./utils/MerkleTree";

export type Address = string;
export type Bytes20 = string;
export type VotingEpochId = number;
export type RewardEpochId = number;
export type MessageHash = string;

export interface EpochResult {
  readonly votingRoundId: number;
  readonly medianData: MedianCalculationResult[];
  readonly randomData: RandomCalculationResult;
  readonly merkleTree: MerkleTree;
}

/**
 * Encapsulates the result of median calculation for a specific voting round.
 */
export interface MedianCalculationResult {
  readonly votingRoundId: number;
  readonly feed: Feed;
  readonly votersSubmitAddresses: readonly string[];
  readonly feedValues: readonly ValueWithDecimals[];
  readonly data: MedianCalculationSummary;
  readonly weights: readonly bigint[];
  readonly totalVotingWeight: bigint; //sum of weights
}

/**
 * Encapsulates the result of random calculation for a specific voting round.
 */
export interface RandomCalculationResult {
  readonly votingRoundId: number;
  readonly random: bigint;
  readonly isSecure: boolean;
}

/**
 * Provides calculation summary for median calculation.
 */
export interface MedianCalculationSummary {
  readonly finalMedianPrice: ValueWithDecimals;
  readonly quartile1Price: ValueWithDecimals;
  readonly quartile3Price: ValueWithDecimals;
  readonly participatingWeight: bigint;
}

/**
 * Feed representation.
 */
export interface Feed {
  /**
   *  Hex-encoded feed id. 21 characters/bytes or 42 hex chars (44 if 0x prefix)
   */
  id: string;
  /**
   * int8 (solidity int8) the number of decimals in the price.
   */
  decimals: number;
}

export enum FeedType {
  None = 0,
  Crypto = 1,
  FX = 2,
  Commodity = 3,
  Stock = 4,
}
