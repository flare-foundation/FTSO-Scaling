import {MessageHash} from "../../ftso-core/src/voting-types";
import {GenericSubmissionData, ParsedFinalizationData, SubmissionData} from "../../ftso-core/src/IndexerClient";
import {ISignaturePayload} from "../../ftso-core/src/fsp-utils/SignaturePayload";
import {AttestationRequest} from "../../contracts/src/events/AttestationRequest";
import {HashSignatures} from "./utils/stat-info/reward-calculation-data";
import {DataForCalculations} from "../../ftso-core/src/data/data-calculation-interfaces";

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