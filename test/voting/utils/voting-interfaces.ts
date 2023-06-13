export interface ClaimReward {
  merkleProof: string[];
  chainId: number;
  epochId: number;
  voterAddress: string;
  amount: BN;
  poolId: string;
  tokenContract: string;
}

export interface BareSignature {
  v: number;
  r: string;
  s: string;
}

export interface RevealBitvoteData {
  random: string;
  merkleRoot: string;
  bitVote: string;
  prices: string; // 4-byte hex strings
}

export interface SignatureData {
  epochId: number;
  merkleRoot: string;
  v: number;
  r: string;
  s: string;
}

export interface TxData {
  blockNumber: number;
  txId: string;
  input?: string;
  from: string;
  to?: string;
  value?: string;
}

// interface BlockData {
//   blockNumber: number;
//   timestamp: number;
// }
export interface EpochData {
  epochId: number;
  merkleRoot?: string;
  random?: string;
  prices?: number[];
  pricesHex?: string;
  bitVote?: string;
}
export type EpochRewards = Map<string, ClaimReward>;

export interface EpochResult {
  epochId: number;
  medianData: any[];
  priceMessage: string;
  fullPriceMessage: string;
  dataMerkleRoot: string;
  dataMerkleProof: string[] | null;
  rewards: EpochRewards;
  fullMessage: string;
  merkleRoot: string;
}

export interface MedianCalculationResult {
  voters?: string[];
  prices?: number[];
  index: BN[];
  data: MedianCalculationSummary;
  weights: BN[];
}

export interface MedianCalculationSummary {
  medianIndex: string;
  quartile1Index: string;
  quartile3Index: string;
  leftSum: string;
  rightSum: string;
  medianWeight: string;
  lowWeightSum: string;
  rewardedWeightSum: string;
  highWeightSum: string;
  finalMedianPrice: string;
  quartile1Price: string;
  quartile3Price: string;
  lowElasticBandPrice: string;
  highElasticBandPrice: string;
}

export interface VoterWithWeight {
  voterAddress: string;
  weight: BN;
  pct: boolean;
  iqr: boolean;
}
