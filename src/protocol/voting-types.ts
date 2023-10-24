import BN from "bn.js";
import { TransactionReceipt } from "web3-core";
import { Bytes32 } from "./utils/sol-types";

export type Address = string;
export type PriceEpochId = number;
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

export interface Feed {
  readonly offerSymbol: string; // 4 characters/bytes
  readonly quoteSymbol: string; // 4 characters/bytes
}

export interface Offer extends Feed {
  amount: BN; // 256-bit
  currencyAddress: string;
  leadProviders: string[]; // list of trusted providers
  rewardBeltPPM: BN; // reward belt in PPM (parts per million) in relation to the median price of the trusted providers.
  elasticBandWidthPPM: BN; // elastic band width in PPM (parts per million) in relation to the median price.
  iqrSharePPM: BN; // Each offer defines IQR and PCT share in PPM (parts per million). The sum of all offers must be 1M.
  pctSharePPM: BN;
  remainderClaimer: string;
}

export interface RewardOffered extends Offer {
  priceEpochId?: number;
  transactionId?: string;
  flrValue: BN;
}

export interface BareSignature {
  readonly v: number;
  readonly r: string;
  readonly s: string;
}

export interface RevealBitvoteData {
  readonly random: string;
  readonly merkleRoot: string;
  readonly bitVote: string;
  readonly prices: string; // 4-byte hex strings
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
  readonly value: string;
  readonly receipt?: TransactionReceipt;
}

export interface BlockData {
  readonly number: number;
  readonly timestamp: number;
  readonly transactions: readonly TxData[];
}

export interface EpochData {
  readonly epochId: number;
  readonly merkleRoot: string;
  readonly random: Bytes32;
  readonly prices: number[];
  readonly pricesHex: string;
  readonly bitVote: string;
}

export interface EpochResult {
  readonly priceEpochId: number;
  readonly medianData: readonly MedianCalculationResult[];
  readonly random: Bytes32;
  readonly randomQuality: number;
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
  readonly prices: readonly number[];
  readonly data: MedianCalculationSummary;
  readonly weights: readonly BN[];
}

export interface MedianCalculationSummary {
  readonly finalMedianPrice: number;
  readonly quartile1Price: number;
  readonly quartile3Price: number;
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
}
