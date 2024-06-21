import { RewardEpochInfo } from "../../../../libs/ftso-core/src/utils/stat-info/reward-epoch-info";

export interface IncrementalCalculationState {
  rewardEpochId: number;
  votingRoundId: number;
  rewardEpochInfo: RewardEpochInfo;
  startVotingRoundId: number;
  // current expected endVotingRoundId. Gets adapted when signing policy for the next reward epoch is detected
  // or when the reward epoch duration extends
  endVotingRoundId: number;
  // the upper bound for calculation of reward data for voting rounds. Gets adapted
  finalProcessedVotingRoundId: number;
  // flag to identify if the next reward epoch is identified through signing policy being initialized
  nextRewardEpochIdentified: boolean;
  // the largest voting round id folder that was created
  maxVotingRoundIdFolder: number;
  // next voting round id for which no secure random number should be obtained
  nextVotingRoundIdWithNoSecureRandom: number;
  // next voting round id for which claims should be calculated
  nextVotingRoundForClaimCalculation: number;
}
