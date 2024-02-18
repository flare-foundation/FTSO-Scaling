import { ISignaturePayload } from "../../fsp-utils/src/SignaturePayload";
import { GenericSubmissionData, ParsedFinalizationData } from "./IndexerClient";
import { RewardEpoch } from "./RewardEpoch";
import { IRevealData } from "./utils/RevealData";
import { Address, Feed, MessageHash } from "./voting-types";

export interface DataForCalculationsPartial {
  // voting round id
  votingRoundId: number;
  // Ordered list of submitAddresses matching the order in the signing policy
  orderedVotersSubmitAddresses: Address[];
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
}

export interface DataForRewardCalculation {
  dataForCalculations: DataForCalculations;
  signatures: Map<MessageHash, GenericSubmissionData<ISignaturePayload>[]>;
  finalizations: ParsedFinalizationData[];
  // might be undefined, if such finalization does not exist in an observed range
  firstSuccessfulFinalization?: ParsedFinalizationData;
}
