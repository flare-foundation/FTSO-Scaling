///////////////////////////////////////////////////////////////////////////////////////////////
// Structure of input JSON produced by initial script for Staking reward calculation
// The script produces data about uptime and node stakes that is used as input to reward 
// calculation to consider minimal conditions.
///////////////////////////////////////////////////////////////////////////////////////////////
export interface Delegator {
   // pChain address, like flare123l344hlugpg0r2ntdl6fn45qyp0f5m2xakc0r
   pAddress: string;
   // cChain address, like 0x4485B10aD3ff29066938922059c5CB1e5e8Ee8b6
   cAddress: string;
   // as string in GWei   
   amount: string;
   // as string in GWei
   delegatorRewardAmount: string;
}

export interface ValidatorInfo {
   // node id in form: NodeID-2a7BPY7UeJv2njMuyUHfBSTeQCYZj6bwV
   nodeId: string;
   // bonding address in form: flare1uz66xddzplexwfdsxrzxsnlwlucyfsuax00crd
   bondingAddress: string;
   // self bond in GWei
   selfBond: string;
   // ftso address in form "0xfe532cB6Fb3C47940aeA7BeAd4d61C5e041D950e",
   ftsoAddress: string;
   // end of stake in unix time
   stakeEnd: number;
   // string of p-chain addresses (in form  flare1uz66xddzplexwfdsxrzxsnlwlucyfsuax00crd)
   pChainAddress: string[];
   // fee in GWei
   fee: number;
   // group number
   group: number;
   // is the validator eligible for staking rewards
   eligible: boolean;
   // data provider name
   ftsoName: string;
   // Boosting eligibility bond in GWei
   BEB: string;
   // Boost delegations in GWei
   boostDelegations: string;
   // boost in GWei
   boost: string;
   // self delegations in GWei
   selfDelegations: string;
   // other delegations in GWei
   normalDelegations: string;
   // total self bond in GWei
   totalSelfBond: string;
   // list of delegators
   delegators: Delegator[];
   // total stake amount in GWei“
   totalStakeAmount: string;
   // C-chain address in form of 0xaDEDCd23941E479b4736B38e271Eb926596BBe3d
   cChainAddress: string;
   // overboost in GWei
   overboost: string;
   // reward weight in GWei
   rewardingWeight: string;
   // capped weight in GWei
   cappedWeight: string;
   // node reward amount in wei
   nodeRewardAmount: string;
   // validator reward amount in wei
   validatorRewardAmount: string;
   // Node id as 20-byte hex string
   nodeId20Byte?: string;
}

///////////////////////////////////////////////////////////////////////////////////////////////
// Minimal condition related "passes" JSON types
///////////////////////////////////////////////////////////////////////////////////////////////

export enum MinimalConditionFailureType {
   // Providers must submit a value estimate that lies within a 0.5% band around the consensus median value 
   // in 80% of voting rounds within a reward epoch.
   FTSO_SCALING_FAILURE = "FTSO_SCALING_FAILURE",
   // Providers must submit at least 80% of their expected number of updates within a reward epoch, 
   // unless they have very low weight, defined as < 0.2% of the total active weight.
   FAST_UPDATES_FAILURE = "FAST_UPDATES_FAILURE",
   // Providers must meet 80% total uptime in the reward epoch with at least 1M FLR in active self-bond. 
   // However, in order to earn passes, the provider must have at least 3M FLR in active self-bond and 15M 
   // in active stake. Providers with 80% total uptime and at least 1M FLR in active self-bond but 
   // not meeting both the 3M FLR active self-bond and 15M active stake requirements neither earn 
   // nor lose passes, and still receive eligible rewards.
   STAKING_FAILURE = "STAKING_AVAILABILITY",
}

export interface MinimalConditionFailure {
   // protocol id
   protocolId: number;
   // failure id
   failureId: MinimalConditionFailureType;
}

export interface DataProviderPasses {
   // epoch id in string
   rewardEpochId: string;
   // voter identity address in lowercase
   voterAddress: string;
   // number of passes. A number between 0 and 3
   passes: number;
   // failures
   failures?: MinimalConditionFailure[];
}

///////////////////////////////////////////////////////////////////////////////////////////////
// Minimal condition calculation result types
///////////////////////////////////////////////////////////////////////////////////////////////

export interface ConditionSummary {
   // whether a minimal condition is met
   conditionMet: boolean;
   // allows for a pass to be earned, if condition is met
   // if any criteria has this flag on true, the pass cannot be earned
   obstructsPass?: boolean;
}

export interface FeedHits {
   // feed name
   feedName: string;
   // hits out of totalHits
   feedHits: number;
   // all feed hits
   totalHits: number;
}

export interface FtsoScalingConditionSummary extends ConditionSummary {
   // total number of feed values, equals number of voting rounds in the reward epoch times number of feeds
   allPossibleHits: number;
   // stat telling how many feed values were not empty
   totalHits: number;
   // feed hit stats for each feed in the canonical feed order
   feedHits: FeedHits[];
}

export interface FUConditionSummary extends ConditionSummary {
   // total updates by all providers in the reward epoch
   totalUpdatesByAll: number;
   // updates by the provider in the reward epoch
   updates: number;
   //exempt due to low weight
   tooLowWeight: boolean;
   // expected PPM share based on the share of the weight
   expectedUpdatesPPM: bigint;
   // expected number of updates
   expectedUpdates: bigint;
}

export interface NodeStakingConditions {
   // node id as 20 byte hex string
   nodeId: string;
   // uptime sufficient
   uptimeOk: boolean;
   // self bond in GWei
   selfBond: bigint;
   // mirrored stake in GWei
   totalMirroredStake: bigint;
   // total stake amount in GWei
   totalStakeAmount: bigint;
}

export interface StakingConditionSummary extends ConditionSummary {
   // total self bond in Gwei
   totalSelfBond: bigint;
   // total stake amount in Gwei
   stake: bigint;
   // stake with uptime
   stakeWithUptime: bigint;
   // node conditions
   nodeConditions: NodeStakingConditions[];
}

// Reflects a record about minimal condition calculation for a data provider.
export interface DataProviderConditions {
   // reward epoch id
   network: string;
   // network name
   rewardEpochId: number;
   // data provider name
   dataProviderName?: string;
   // voter identity address
   voterAddress: string;
   // voter index
   voterIndex: number;
   // passes held
   passesHeld: number;
   // strikes
   strikes: number;
   // pass earned
   passEarned: boolean;
   // eligible for reward
   eligibleForReward: boolean;
   // new number of passes after the reward epoch calculation
   newNumberOfPasses: number;
   // ftso scaling conditions
   ftsoScaling: FtsoScalingConditionSummary;
   // fast update conditions
   fastUpdates: FUConditionSummary;
   // staking conditions
   staking: StakingConditionSummary;
}

///////////////////////////////////////////////////////////////////////////////////////////////
// Listed providers for Bifrost wallet types
///////////////////////////////////////////////////////////////////////////////////////////////

export interface ListedProviderListVersion {
   major: number;
   minor: number;
   patch: number;
}

export interface ListedProvider {
   chainId: number;
   name: string;
   description: string;
   url: string;
   address: string;
   logoURI: string;
   listed: boolean;
}

export interface ListedProviderList {
   name: string;
   timestamp: string;
   version: ListedProviderListVersion;
   providers: ListedProvider[];
}