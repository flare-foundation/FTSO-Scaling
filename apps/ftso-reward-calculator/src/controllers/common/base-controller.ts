import { RewardClaimUnit } from "../../dto/reward-claim.dto";

export abstract class BaseRewardingController {
  abstract getClaimsForRewardEpoch(rewardEpochId: number): Promise<RewardClaimUnit[]>;
}
