import { SubmissionData } from "../IndexerClient";
import { RewardEpoch } from "../RewardEpoch";
import { IRevealData } from "./RevealData";
import { Address, Feed } from "../voting-types";

export interface DataForCalculationsPartial {
  // voting round id
  votingRoundId: number;
  // Ordered list of submitAddresses matching the order in the signing policy
  orderedVotersSubmitAddresses: Address[];
  // Ordered list of submitSignatureAddresses matching the order in the signing policy
  orderedVotersSubmitSignatureAddresses: Address[];
  // Reveals from eligible submitAddresses that match to existing commits
  validEligibleReveals: Map<Address, IRevealData>;
  // submitAddresses of eligible voters that committed but withheld or provided wrong reveals in the voting round
  revealOffenders: Set<Address>;
  // Median voting weight
  voterMedianVotingWeights: Map<Address, bigint>;
  // Feed order for the reward epoch of the voting round id
  feedOrder: Feed[];
}

export interface DataForCalculations extends DataForCalculationsPartial {
  // Window in which offenses related to reveal offenders or providing wrong reveals are counted
  randomGenerationBenchingWindow: number;
  // Set of offending submitAddresses in the randomGenerationBenchingWindow
  benchingWindowRevealOffenders: Set<Address>;
  // Reward epoch
  rewardEpoch: RewardEpoch;
  // valid eligible bit-votes
  validEligibleBitVoteSubmissions?: SubmissionData[];
}
