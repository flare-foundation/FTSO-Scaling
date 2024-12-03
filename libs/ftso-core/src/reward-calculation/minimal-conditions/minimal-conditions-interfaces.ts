
export interface ConditionSummary {
   // whether a minimal condition is met
   conditionMet: boolean;
   // allows for a pass to be earned, if condition is met
   // if any criteria has this flag on true, the pass cannot be earned
   obstructsPass?: boolean;
}

export interface FeedHits {
   // feed id
   feedId: string;
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

export interface DataProviderConditions {
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
