export enum RewardClaimTypeEnum {
  DIRECT = 'direct',
  FEE = 'fee',
  WFLR = 'wflr',
  MIRROR = 'mirror',
  CCHAIN = 'cchain',
}

export class RewardClaimUnit {
  rewardEpochId: number;
  beneficiary: string;
  amount: string;
  type: RewardClaimTypeEnum;
}
