import { ClaimType, IRewardClaim } from "../../../../libs/ftso-core/src/utils/RewardClaim";

export class RewardClaimUnit {
  rewardEpochId: number;
  beneficiary: string;
  amount: string;
  type: ClaimType;

  public static from(claim: IRewardClaim): RewardClaimUnit {
    const unit = new RewardClaimUnit();
    unit.amount = claim.amount.toString();
    unit.beneficiary = claim.beneficiary;
    unit.type = claim.claimType;
    unit.rewardEpochId = claim.rewardEpochId;
    return unit;
  }
}
