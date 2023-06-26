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
  priceEpochId?: number;
  transactionId?: string;
  trustedProviders: string[]; // list of trusted providers
  rewardBeltPPM: BN; // reward belt in PPM (parts per million) in relation to the median price of the trusted providers.
  flrValue: BN;   // Value of the offer in the native currency (calculated on offer submission) 
}

export interface FeedValue extends Feed {
  feedId: string;
  flrValue: BN;
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

export interface EpochData {
  epochId: number;
  merkleRoot?: string;
  random?: string;
  prices?: number[];
  pricesHex?: string;
  bitVote?: string;
}

export interface EpochResult {
  priceEpochId: number;
  medianData: MedianCalculationResult[];
  priceMessage: string;
  symbolMessage: string;
  fullPriceMessage: string;
  dataMerkleRoot: string;
  dataMerkleProof: string[] | null;
  // voter => claim
  rewards: Map<string, ClaimReward>;
  fullMessage: string;
  merkleRoot: string;
}

export interface MedianCalculationResult {
  feed: Feed;  
  voters?: string[];
  prices?: number[];
  data: MedianCalculationSummary;
  weights: BN[];
}

export interface MedianCalculationSummary {
  finalMedianPrice: number;
  quartile1Price: number;
  quartile3Price: number;
  lowElasticBandPrice: number;
  highElasticBandPrice: number;
}

export interface VoterWithWeight {
  voterAddress: string;
  weight: BN;
  pct: boolean;
  iqr: boolean;
}
