// FTSO anchor feeds: Providers must submit a value estimate that lies within a 0.5% band around the consensus median value in 80%
// of voting rounds within a reward epoch.
//
// FTSO block-latency feeds: Providers must submit at least 80% of their expected number of updates within a reward epoch,
// unless they have very low weight, defined as < 0.2% of the total active weight.
//
// Staking: Providers must meet 80% total uptime in the reward epoch with at least 1M FLR in active self-bond.
// However, in order to earn passes, the provider must have at least 3M FLR in active self-bond and 15M in active stake.
// Providers with 80% total uptime and at least 1M FLR in active self-bond but not meeting both the 3M FLR active self-bond
// and 15M active stake requirements neither earn nor lose passes, and still receive eligible rewards.
//
// FDC: Successful participation in 60% of all voting rounds in that reward epoch.

export const TOTAL_PPM = 1000000n;
export const FTSO_SCALING_AVAILABILITY_THRESHOLD_PPM = 800000n; // 80%
export const FTSO_SCALING_CLOSENESS_THRESHOLD_PPM = 5000n; // 0.5%
export const FU_THRESHOLD_PPM = 800000n; // 80%
export const FU_CONSIDERATION_THRESHOLD_PPM = 2000n; // 0.2% of the weight
export const STAKING_UPTIME_THRESHOLD_PPM = 800000n; // 80%
export const STAKING_MIN_SELF_BOND_GWEI = 1000000000000000n; // 1M FLR
export const STAKING_MIN_DESIRED_SELF_BOND_GWEI = 3000000000000000n; // 3M FLR
export const STAKING_MIN_DESIRED_STAKE_GWEI = 15000000000000000n; // 15M FLR
export const MAX_NUMBER_OF_PASSES = 3; // 3 passes
export const FDC_REWARDED_SHARE_PPM = 600000n; // 60%
