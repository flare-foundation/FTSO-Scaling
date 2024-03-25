import { VotingEpochId } from "../voting-types";

export interface RewardEpochDuration {
  rewardEpochId: number;
  startVotingRoundId: VotingEpochId;
  endVotingRoundId: VotingEpochId;
  expectedEndUsed: boolean;
}
