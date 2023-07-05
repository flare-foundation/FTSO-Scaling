export interface ClaimReward {
  merkleProof: string[];
  hash?: string;
  claimRewardBody: ClaimRewardBody;
};

export function deepCopyClaim(claim: ClaimReward): ClaimReward {
  return {
    ...claim,
    merkleProof: [...claim.merkleProof],
    claimRewardBody: {
      ...claim.claimRewardBody
    }
  }
}

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
  leadProviders: string[]; // list of trusted providers
  rewardBeltPPM: BN; // reward belt in PPM (parts per million) in relation to the median price of the trusted providers.
  elasticBandWidthPPM: BN; // elastic band width in PPM (parts per million) in relation to the median price.
  iqrSharePPM: BN; // Each offer defines IQR and PCT share in PPM (parts per million). The summ of all offers must be 1M.
  pctSharePPM: BN;
}

export interface RewardOffered extends Offer {
  priceEpochId?: number;
  transactionId?: string;
  remainderClaimer: string;
  flrValue: BN;
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
  hash: string;
  input?: string;
  from: string;
  to?: string;
  value?: string;
  receipt?: any;
}

export interface BlockData {
  number: number;
  timestamp: number;
  transactions: TxData[];
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
  dataMerkleProof: string;
  // voter => claim
  rewards: Map<string, ClaimReward[]>;
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
}

export interface VoterWithWeight {
  voterAddress: string;
  weight: BN;
  pct: boolean;   // gets PCT reward
  iqr: boolean;   // gets IQR reward
  eligible: boolean;  // is eligible for reward
}
