export interface ClaimReward {
  merkleProof: string[];
  claimRewardBody: ClaimRewardBody;
};

export interface ClaimRewardBody {
  amount: BN; // 256-bit
  currencyAddress: string;
  voterAddress: string;
  epochId: number;
}

export interface Feed {
  offerSymbol: string, // 4 characters/bytes
  quoteSymbol: string, // 4 characters/bytes  
}

export interface Offer extends Feed {
  amount: BN; // 256-bit
  currencyAddress: string;
}

export type FeedRewards = Map<string, Offer[]>;

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
  symbol: Feed;  
  voters?: string[];
  prices?: number[];
  data: MedianCalculationSummary;
  weights: BN[];
  offers?: RewardOffer[];
}

export interface MedianCalculationSummary {
  finalMedianPrice: number;
  quartile1Price: number;
  quartile3Price: number;
  lowElasticBandPrice: number;
  highElasticBandPrice: number;
}

export interface RewardOffer {
  priceEpochId?: number;
  transactionId: string;
  rewardEpochId: number;
  symbol: string;
  amount: BN;
  tokenContract: string; // address of the token contract. If zero address, then it is the native token.
  trustedProviders: string[]; // list of trusted providers
  rewardBeltPPM: number; // reward belt in PPM (parts per million) in relation to the median price of the trusted providers.
}

export interface VoterWithWeight {
  voterAddress: string;
  weight: BN;
  pct: boolean;
  iqr: boolean;
}
