// Events exports

import { InflationRewardsOffered } from "./InflationRewardsOffered";
import { VoterRegistered } from "./VoterRegistered";
import { RewardsOffered } from "./RewardsOffered";
import { VoterRegistrationInfo } from "./VoterRegistrationInfo";

export { SigningPolicyInitialized } from "./SigningPolicyInitialized";
export { InflationRewardsOffered } from "./InflationRewardsOffered";
export { RandomAcquisitionStarted } from "./RandomAcquisitionStarted";
export { RewardEpochStarted } from "./RewardEpochStarted";
export { RewardsOffered } from "./RewardsOffered";
export { VotePowerBlockSelected } from "./VotePowerBlockSelected";
export { VoterRegistered } from "./VoterRegistered";
export { VoterRegistrationInfo } from "./VoterRegistrationInfo";
export { SigningPolicySigned } from "./SigningPolicySigned";

// Helpers

export interface RewardOffers {
  inflationOffers: InflationRewardsOffered[];
  rewardOffers: RewardsOffered[];
}

export interface FullVoterRegistrationInfo {
  voterRegistrationInfo: VoterRegistrationInfo;
  voterRegistered: VoterRegistered;
}
