import { ISignaturePayload } from "../../fsp-utils/src/SignaturePayload";
import { GenericSubmissionData, ParsedFinalizationData, SubmissionData } from "./IndexerClient";
import { RewardEpoch } from "./RewardEpoch";
import { AttestationRequest } from "./events/AttestationRequest";
import { IRevealData } from "./utils/RevealData";
import { HashSignatures } from "./utils/stat-info/reward-calculation-data";
import { Address, Feed, MessageHash } from "./voting-types";

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

export interface DataForRewardCalculation {
  // FTSO Scaling
  dataForCalculations: DataForCalculations;
  signatures: Map<MessageHash, GenericSubmissionData<ISignaturePayload>[]>;
  finalizations: ParsedFinalizationData[];
  // might be undefined, if such finalization does not exist in an observed range
  firstSuccessfulFinalization?: ParsedFinalizationData;
  // FAST UPDATES
  fastUpdatesData?: FastUpdatesDataForVotingRound;
  // FDC
  fdcData?: FDCDataForVotingRound;
}

export interface FastUpdatesDataForVotingRound {
  votingRoundId: number;
  feedValues: bigint[];
  feedDecimals: number[];
  signingPolicyAddressesSubmitted: string[];
}

export interface PartialFDCDataForVotingRound {
  votingRoundId: number;
  // List of attestation requests to be processed
  attestationRequests: AttestationRequest[];
  // list of non-duplication indices
  nonDuplicationIndices: number[][];
}

/**
 * Represents a signer, that:
 * - has submitted a signature for voting round N, before the end of the voting round N + 1
 * - signature signed the consensus bitvote
 * - might or might not have submitted a bitvote
 */
export interface FDCEligibleSigner {
  submitSignatureAddress: string;
  votingEpochIdFromTimestamp: number;
  timestamp: number;
  // Relative timestamp in voting epoch N + 1
  relativeTimestamp: number;
  bitVote?: string;
  dominatesConsensusBitVote: boolean;
  weight: number;
}


export enum FDCOffense {
  NO_REVEAL_ON_BITVOTE = "NO_REVEAL_ON_BITVOTE",
  WRONG_SIGNATURE = "WRONG_SIGNATURE",
  BAD_CONSENSUS_BITVOTE_CANDIDATE = "BAD_CONSENSUS_BITVOTE_CANDIDATE",
}
export interface FDCOffender {
  submissionAddress: string;
  submitSignatureAddress: string;
  offenses: FDCOffense[];
  weight: number;
}

export interface FDCRewardData {
  // ----- These data is added after the reward calculation for log ------
  // Filtered signatures that match the first finalized protocol Merkle root message
  // One per eligible data provider
  eligibleSigners?: FDCEligibleSigner[];
  // Majority bitvote attached to the finalized signatures
  // All signers that have unmatching majority bitvote are considered as offenders
  consensusBitVote?: bigint;
  // FDC offenders
  fdcOffenders?: FDCOffender[];
  // Consensus bitVote indices
  consensusBitVoteIndices?: number[];
}

export interface FDCDataForVotingRound extends PartialFDCDataForVotingRound, FDCRewardData {
  // List of bitvotes for the consensus bitvote
  // Only last bitvote for each data provider is included
  // submit address is used to assign to data provider
  bitVotes: SubmissionData[];
  // signature data, include the unsigned message, which should be consensus bitvote
  // Might be multiple signatures by the same data provider
  // All signatures for FDC protocol in the observed range are included and sorted in the order of arrival
  signaturesMap: Map<MessageHash, GenericSubmissionData<ISignaturePayload>[]>
  // First successful finalization
  // might be undefined, if such finalization does not exist in an observed range
  // If defined then we can check if signatures are correct
  firstSuccessfulFinalization?: ParsedFinalizationData;
  // All finalizations in the observed range
  finalizations: ParsedFinalizationData[];
}

export interface SFDCDataForVotingRound {
  votingRoundId: number;
  attestationRequests: AttestationRequest[];
  bitVotes: SubmissionData[];
  signatures: HashSignatures[];
  firstSuccessfulFinalization?: ParsedFinalizationData;
  finalizations: ParsedFinalizationData[];
  eligibleSigners: FDCEligibleSigner[];
  consensusBitVote: bigint;
  fdcOffenders: FDCOffender[];
  consensusBitVoteIndices: number[];
  signaturesMap?: Map<MessageHash, GenericSubmissionData<ISignaturePayload>[]>;
}

export interface FUFeedValue {
  feedId: string;
  value: bigint;
  decimals: number;
}
