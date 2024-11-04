import { sign } from "crypto";
import { ECDSASignature } from "../../fsp-utils/src/ECDSASignature";
import { ProtocolMessageMerkleRoot } from "../../fsp-utils/src/ProtocolMessageMerkleRoot";
import { RelayMessage } from "../../fsp-utils/src/RelayMessage";
import { ISignaturePayload, SignaturePayload } from "../../fsp-utils/src/SignaturePayload";
import { SigningPolicy } from "../../fsp-utils/src/SigningPolicy";
import {
  BlockAssuranceResult,
  FinalizationData,
  GenericSubmissionData,
  IndexerClient,
  ParsedFinalizationData,
  SubmissionData,
} from "./IndexerClient";
import { RewardEpoch } from "./RewardEpoch";
import { RewardEpochManager } from "./RewardEpochManager";
import { ContractMethodNames } from "./configs/contracts";
import {
  ADDITIONAL_REWARDED_FINALIZATION_WINDOWS,
  EPOCH_SETTINGS,
  FTSO2_PROTOCOL_ID,
  GENESIS_REWARD_EPOCH_START_EVENT,
  WRONG_SIGNATURE_INDICATOR_MESSAGE_HASH,
} from "./configs/networks";
import {
  DataForCalculations,
  DataForCalculationsPartial,
  DataForRewardCalculation,
} from "./data-calculation-interfaces";
import { CommitData, ICommitData } from "./utils/CommitData";
import { ILogger } from "./utils/ILogger";
import { IRevealData, RevealData } from "./utils/RevealData";
import { errorString } from "./utils/error";
import { Address, Feed, MessageHash } from "./voting-types";

/**
 * Data availability status for data manager responses.
 */
export enum DataAvailabilityStatus {
  /**
   * All relevant data is available on the indexer and the data is consistent.
   */
  OK,
  /**
   * The data is either not fully available in the indexer database or the data is inconsistent.
   */
  NOT_OK,
  /**
   * The data may not be fully available on the indexer on the top of needed block range due to endTime requirements,
   * but the timeout time has passed, so the data it timeout conditionally OK.
   */
  TIMEOUT_OK,
}

/**
 * Response wrapper for data manager responses.
 */
export interface DataMangerResponse<T> {
  status: DataAvailabilityStatus;
  data?: T;
}

export interface CommitsAndReveals {
  votingRoundId: number;
  commits: Map<Address, ICommitData>;
  reveals: Map<Address, IRevealData>;
}

export interface CommitAndRevealSubmissionsMappingsForRange {
  votingRoundIdToCommits: Map<number, SubmissionData[]>;
  votingRoundIdToReveals: Map<number, SubmissionData[]>;
}

export interface SignAndFinalizeSubmissionData {
  signatures: SubmissionData[];
  finalizations: FinalizationData[];
}

/**
 * Helps in extracting data in a consistent way for FTSO scaling feed median calculations, random number calculation and rewarding.
 * It uses indexerClient to query data from c chain indexer database
 * It uses rewardEpochManager to get correct reward epoch configuration for a given voting round id
 * It uses EPOCH_SETTINGS to get manage timestamp to voting round id conversions
 */
export class DataManager {
  constructor(
    protected readonly indexerClient: IndexerClient,
    protected readonly rewardEpochManager: RewardEpochManager,
    protected readonly logger: ILogger
  ) { }

  /**
   * Prepare data for median calculation and rewarding given the voting round id and the random generation benching window.
   *  - queries relevant commits and reveals from chain indexer database
   *  - filters out leaving valid and matching commits and reveals pairs
   *  - filters out leaving commits and reveals by eligible voters in the current reward epoch
   *  - calculates reveal offenders in the voting round id
   *  - calculates all reveal offenders in the random generation benching window (@param votingRoundId - @param randomGenerationBenchingWindow, @param votingRoundId - 1)
   */
  public async getDataForCalculations(
    votingRoundId: number,
    randomGenerationBenchingWindow: number,
    endTimeout?: number
  ): Promise<DataMangerResponse<DataForCalculations>> {
    const startVotingRoundId = votingRoundId - randomGenerationBenchingWindow;
    const endVotingRoundId = votingRoundId;
    const mappingsResponse = await this.getCommitAndRevealMappingsForVotingRoundRange(
      startVotingRoundId,
      endVotingRoundId,
      endTimeout
    );
    if (
      mappingsResponse.status === DataAvailabilityStatus.NOT_OK ||
      (mappingsResponse.status === DataAvailabilityStatus.TIMEOUT_OK && !endTimeout)
    ) {
      this.logger.warn(
        `No commit reveal mappings found for voting round range ${startVotingRoundId} - ${endVotingRoundId}`
      );
      return {
        status: mappingsResponse.status,
      };
    }
    const commits = mappingsResponse.data.votingRoundIdToCommits.get(votingRoundId) || [];
    const reveals = mappingsResponse.data.votingRoundIdToReveals.get(votingRoundId) || [];
    this.logger.debug(`Commits for voting round ${votingRoundId}: ${JSON.stringify(commits)}`);
    this.logger.debug(`Reveals for voting round ${votingRoundId}: ${JSON.stringify(reveals)}`);

    const rewardEpoch = await this.rewardEpochManager.getRewardEpochForVotingEpochId(votingRoundId);
    if (!rewardEpoch) {
      this.logger.warn(`No reward epoch found for voting round ${votingRoundId}`);
      return {
        status: DataAvailabilityStatus.NOT_OK,
      };
    }
    const votersToCommitsAndReveals = this.getVoterToLastCommitAndRevealMapsForVotingRound(
      votingRoundId,
      commits,
      reveals,
      rewardEpoch.canonicalFeedOrder
    );
    const partialData = this.getDataForCalculationsPartial(votersToCommitsAndReveals, rewardEpoch);
    const benchingWindowRevealOffenders = await this.getBenchingWindowRevealOffenders(
      votingRoundId,
      rewardEpoch.rewardEpochId,
      rewardEpoch.startVotingRoundId,
      mappingsResponse.data.votingRoundIdToCommits,
      mappingsResponse.data.votingRoundIdToReveals,
      randomGenerationBenchingWindow,
      (votingRoundId: number) =>
        this.rewardEpochManager.getRewardEpochForVotingEpochId(votingRoundId, rewardEpoch.rewardEpochId + 1)
    );

    this.logger.debug(`Valid reveals from: ${JSON.stringify(Array.from(partialData.validEligibleReveals.keys()))}`);
    return {
      status: mappingsResponse.status,
      data: {
        ...partialData,
        randomGenerationBenchingWindow,
        benchingWindowRevealOffenders,
        rewardEpoch,
      } as DataForCalculations,
    };
  }

  /**
   * Provides the data for reward calculation given the voting round id and the random generation benching window.
   * Since calculation of rewards takes place when all the data is surely on the blockchain, no timeout queries are relevant here.
   * The data for reward calculation is composed of:
   * - data for median calculation
   * - signatures for the given voting round id in given rewarding window
   * - finalizations for the given voting round id in given rewarding window
   * Data for median calculation is used to calculate the median feed value for each feed in the rewarding boundaries.
   * The data also contains the RewardEpoch objects, which contains all reward offers.
   * Signatures and finalizations are used to calculate the rewards for signature deposition and finalizations.
   * Each finalization is checked if it is valid and finalizable. Note that only one such finalization is fully executed on chain, while
   * others are reverted. Nevertheless, all finalizations in rewarded window are considered for the reward calculation, since a certain
   * subset is eligible for a reward if submitted in due time.
   */
  public async getDataForRewardCalculation(
    votingRoundId: number,
    randomGenerationBenchingWindow: number
  ): Promise<DataMangerResponse<DataForRewardCalculation>> {
    const dataForCalculationsResponse = await this.getDataForCalculations(
      votingRoundId,
      randomGenerationBenchingWindow
    );
    if (dataForCalculationsResponse.status !== DataAvailabilityStatus.OK) {
      return {
        status: dataForCalculationsResponse.status,
      };
    }
    const signaturesResponse = await this.getSignAndFinalizeSubmissionDataForVotingRound(votingRoundId);
    if (signaturesResponse.status !== DataAvailabilityStatus.OK) {
      return {
        status: signaturesResponse.status,
      };
    }
    const signatures = DataManager.extractSignatures(
      votingRoundId,
      dataForCalculationsResponse.data.rewardEpoch,
      signaturesResponse.data.signatures,
      FTSO2_PROTOCOL_ID,
      undefined,
      this.logger
    );
    const finalizations = this.extractFinalizations(
      votingRoundId,
      dataForCalculationsResponse.data.rewardEpoch,
      signaturesResponse.data.finalizations,
      FTSO2_PROTOCOL_ID
    );
    const firstSuccessfulFinalization = finalizations.find(finalization => finalization.successfulOnChain);
    return {
      status: DataAvailabilityStatus.OK,
      data: {
        dataForCalculations: dataForCalculationsResponse.data,
        signatures,
        finalizations,
        firstSuccessfulFinalization,
      },
    };
  }

  /**
   * Creates a pair of mappings
   * 1. votingRoundId -> commit submissions, chronologically ordered
   * 2. votingRoundId -> reveal submissions, chronologically ordered, too late filtered out
   * It covers all voting rounds in the given range. For each voting round id it
   * ensures that exactly all commit and reveal submissions are present and ordered
   * also ensures that all reveal happen in the correct time windows
   * in blockchain chronological order.
   * @param startVotingRoundId
   * @param endVotingRoundId
   * @param endTimeout
   * @returns
   */
  protected async getCommitAndRevealMappingsForVotingRoundRange(
    startVotingRoundId: number,
    endVotingRoundId: number,
    endTimeout?: number
  ): Promise<DataMangerResponse<CommitAndRevealSubmissionsMappingsForRange>> {
    const commitSubmissionResponse = await this.indexerClient.getSubmissionDataInRange(
      ContractMethodNames.submit1,
      EPOCH_SETTINGS().votingEpochStartSec(startVotingRoundId),
      EPOCH_SETTINGS().votingEpochEndSec(endVotingRoundId)
    );
    // Timeout is only considered when querying the reveals data which come later
    if (commitSubmissionResponse.status !== BlockAssuranceResult.OK) {
      return {
        status: DataAvailabilityStatus.NOT_OK,
      };
    }
    const revealSubmissionResponse = await this.indexerClient.getSubmissionDataInRange(
      ContractMethodNames.submit2,
      EPOCH_SETTINGS().votingEpochStartSec(startVotingRoundId + 1),
      EPOCH_SETTINGS().revealDeadlineSec(endVotingRoundId + 1),
      endTimeout
    );
    if (revealSubmissionResponse.status === BlockAssuranceResult.NOT_OK) {
      return {
        status: DataAvailabilityStatus.NOT_OK,
      };
    }
    if (revealSubmissionResponse.status === BlockAssuranceResult.TIMEOUT_OK) {
      this.logger.warn("Used reveals data with timeout assumption on indexer client. TIMEOUT_OK");
    }

    const votingRoundIdToCommits = this.remapSubmissionDataArrayToVotingRounds(commitSubmissionResponse.data, "commit");
    const votingRoundIdToReveals = this.remapSubmissionDataArrayToVotingRounds(revealSubmissionResponse.data, "reveal");

    // Filtering out too late reveals
    for (const [votingRoundId, revealSubmissions] of votingRoundIdToReveals.entries()) {
      const filteredRevealSubmissions = this.filterRevealsByDeadlineTime(revealSubmissions);
      votingRoundIdToReveals.set(votingRoundId, filteredRevealSubmissions);
    }

    return {
      status:
        revealSubmissionResponse.status === BlockAssuranceResult.TIMEOUT_OK
          ? DataAvailabilityStatus.TIMEOUT_OK
          : DataAvailabilityStatus.OK,
      data: {
        votingRoundIdToCommits,
        votingRoundIdToReveals,
      },
    };
  }

  /**
   * Extract signatures and finalizations for the given voting round id from indexer database.
   * This function is used for reward calculation, which is executed at the time when all the data
   * is surely on the blockchain. Nevertheless the data availability is checked. Timeout queries are
   * not relevant here. The transactions are taken from the rewarded window for each
   * voting round. The rewarded window starts at the reveal deadline which is in votingEpochId = votingRoundId + 1.
   * The end of the rewarded window is the end of voting epoch with
   * votingEpochId = votingRoundId + 1 + ADDITIONAL_REWARDED_FINALIZATION_WINDOWS.
   * Rewarding will consider submissions are finalizations only in the rewarding window and this function
   * queries exactly those.
   * @param votingRoundId
   * @returns
   */
  protected async getSignAndFinalizeSubmissionDataForVotingRound(
    votingRoundId: number
  ): Promise<DataMangerResponse<SignAndFinalizeSubmissionData>> {
    const submitSignaturesSubmissionResponse = await this.indexerClient.getSubmissionDataInRange(
      ContractMethodNames.submitSignatures,
      EPOCH_SETTINGS().revealDeadlineSec(votingRoundId + 1) + 1,
      EPOCH_SETTINGS().votingEpochEndSec(votingRoundId + 1 + ADDITIONAL_REWARDED_FINALIZATION_WINDOWS)
    );
    if (submitSignaturesSubmissionResponse.status !== BlockAssuranceResult.OK) {
      return {
        status: DataAvailabilityStatus.NOT_OK,
      };
    }
    const signatures = submitSignaturesSubmissionResponse.data;
    DataManager.sortSubmissionDataArray(signatures);
    // Finalization data only on the rewarded range
    const submitFinalizeSubmissionResponse = await this.indexerClient.getFinalizationDataInRange(
      EPOCH_SETTINGS().revealDeadlineSec(votingRoundId + 1) + 1,
      EPOCH_SETTINGS().votingEpochEndSec(votingRoundId + 1 + ADDITIONAL_REWARDED_FINALIZATION_WINDOWS)
    );
    if (submitFinalizeSubmissionResponse.status !== BlockAssuranceResult.OK) {
      return {
        status: DataAvailabilityStatus.NOT_OK,
      };
    }
    const finalizations = submitFinalizeSubmissionResponse.data;
    DataManager.sortSubmissionDataArray(finalizations);
    return {
      status: DataAvailabilityStatus.OK,
      data: {
        signatures,
        finalizations,
      },
    };
  }

  /**
   * Extract signature payloads for the given voting round id from the given submissions.
   * Each signature is filtered out for the correct voting round id, protocol id and eligible signer.
   * Signatures are returned in the form of a map
   * from message hash to a list of signatures to submission data containing parsed signature payload.
   * The last signed message for a specific message hash is considered.
   * ASSUMPTION: all signature submissions for voting round id, hence contained ,
   * between reveal deadline for votingRoundId (hence in voting epoch votingRoundId + 1) and
   * the end of the voting epoch votingRoundId + 1 + ADDITIONAL_REWARDED_FINALIZATION_WINDOWS
   * @param votingRoundId
   * @param rewardEpoch
   * @param submissions
   * @returns
   */
  public static extractSignatures(
    votingRoundId: number,
    rewardEpoch: RewardEpoch,
    submissions: SubmissionData[],
    protocolId = FTSO2_PROTOCOL_ID,
    providedMessageHash: MessageHash | undefined = undefined,
    logger: ILogger
  ): Map<MessageHash, GenericSubmissionData<ISignaturePayload>[]> {
    const signatureMap = new Map<MessageHash, Map<Address, GenericSubmissionData<ISignaturePayload>>>();
    for (const submission of submissions) {
      for (const message of submission.messages) {
        try {
          const signaturePayload = SignaturePayload.decode(message.payload);
          if(signaturePayload.message && signaturePayload.message.protocolId !== message.protocolId) {
            throw new Error(`Protocol id mismatch in signed message. Expected ${message.protocolId}, got ${signaturePayload.message.protocolId}`);
          }
          if(signaturePayload.message && signaturePayload.message.votingRoundId !== message.votingRoundId) {
            throw new Error(`Voting round id mismatch in signed message. Expected ${message.votingRoundId}, got ${signaturePayload.message.votingRoundId}`);
          }
          if (
            message.votingRoundId === votingRoundId &&
            message.protocolId === protocolId
          ) {
            // - Override the messageHash if provided
            // - Require 

            let messageHash = providedMessageHash ?? ProtocolMessageMerkleRoot.hash(signaturePayload.message);

            const signer = ECDSASignature.recoverSigner(messageHash, signaturePayload.signature).toLowerCase();
            // submit signature address should match the signingPolicyAddress
            const expectedSigner = rewardEpoch.getSigningAddressFromSubmitSignatureAddress(submission.submitAddress.toLowerCase());
            // if the expected signer is not found, the signature is not valid for rewarding
            if (!expectedSigner) {
              continue;
            }
            // In case of FTSO Scaling, we have message hash as a part of payload
            // the signer is incorrect
            if (!providedMessageHash) {
              if (!rewardEpoch.isEligibleSignerAddress(signer)) {
                continue;
              }
              signaturePayload.messageHash = messageHash;
              signaturePayload.signer = signer;
              signaturePayload.weight = rewardEpoch.signerToSigningWeight(signer);
              signaturePayload.index = rewardEpoch.signerToVotingPolicyIndex(signer);
            } else {
              if (signer !== expectedSigner) {
                if (!rewardEpoch.isEligibleSignerAddress(expectedSigner)) {
                  continue;
                }
                // wrong signature by eligible signer                
                signaturePayload.messageHash = WRONG_SIGNATURE_INDICATOR_MESSAGE_HASH;
              } else {
                signaturePayload.messageHash = providedMessageHash;
              }
              signaturePayload.signer = expectedSigner;
              signaturePayload.weight = rewardEpoch.signerToSigningWeight(expectedSigner);
              signaturePayload.index = rewardEpoch.signerToVotingPolicyIndex(expectedSigner);
            }

            if (
              signaturePayload.weight === undefined ||
              signaturePayload.signer === undefined ||
              signaturePayload.index === undefined
            ) {
              // assert: this should never happen
              throw new Error(
                `Critical error: signerToSigningWeight or signerToDelegationAddress is not defined for signer ${signer}`
              );
            }
            const signatures =
              signatureMap.get(messageHash) || new Map<Address, GenericSubmissionData<ISignaturePayload>>();
            const submissionData: GenericSubmissionData<ISignaturePayload> = {
              ...submission,
              messages: signaturePayload,
            };
            signatureMap.set(messageHash, signatures);
            signatures.set(signer, submissionData);
          }
        } catch (e) {
          console.log(e)
          logger.warn(`Issues with parsing submission message: ${e.message}`);
        }
      }
    }
    const result = new Map<MessageHash, GenericSubmissionData<ISignaturePayload>[]>();
    for (const [hash, sigMap] of signatureMap.entries()) {
      const values = [...sigMap.values()];
      DataManager.sortSubmissionDataArray(values);
      // consider only the first sent signature of a sender as rewardable
      const existingSenderAddresses = new Set<Address>();
      const filteredSignatureSubmissions: GenericSubmissionData<ISignaturePayload>[] = [];
      for (const submission of values) {
        if (!existingSenderAddresses.has(submission.submitAddress.toLowerCase())) {
          filteredSignatureSubmissions.push(submission);
          existingSenderAddresses.add(submission.submitAddress.toLowerCase());
        }
      }
      result.set(hash, filteredSignatureSubmissions);
    }
    return result;
  }

  /**
   * Given submissions of finalizations eligible for voting round @param votingRoundId and matching reward epoch @param rewardEpoch to the
   * voting round id, extract finalizations which match voting round id, given protocol id and are parsable and finalizeable (would cause finalisation)
   * @param votingRoundId
   * @param rewardEpoch
   * @param submissions
   * @param protocolId
   * @returns
   */
  protected extractFinalizations(
    votingRoundId: number,
    rewardEpoch: RewardEpoch,
    submissions: FinalizationData[],
    protocolId = FTSO2_PROTOCOL_ID
  ): ParsedFinalizationData[] {
    const finalizations: ParsedFinalizationData[] = [];
    for (const submission of submissions) {
      try {
        let calldata = submission.messages;
        if (calldata.startsWith("0x")) {
          calldata = calldata.slice(2);
        }

        if (calldata.length < 10) {
          continue;
        }
        try {
          const relayMessage = RelayMessage.decode(calldata.slice(8));
          // ignore irrelevant messages
          if (
            !relayMessage.protocolMessageMerkleRoot ||
            relayMessage.protocolMessageMerkleRoot.protocolId !== protocolId ||
            relayMessage.protocolMessageMerkleRoot.votingRoundId !== votingRoundId ||
            relayMessage.signingPolicy.rewardEpochId !== rewardEpoch.rewardEpochId
          ) {
            continue;
          }
          // TODO: Check if the signing policy is correct
          const rewardEpochSigningPolicyHash = SigningPolicy.hash(rewardEpoch.signingPolicy);
          const relayingSigningPolicyHash = SigningPolicy.hash(relayMessage.signingPolicy);
          if (rewardEpochSigningPolicyHash !== relayingSigningPolicyHash) {
            throw new Error(
              `Signing policy mismatch. Expected hash: ${rewardEpochSigningPolicyHash}, got ${relayingSigningPolicyHash}`
            );
          }
          const finalization: ParsedFinalizationData = {
            ...submission,
            messages: relayMessage,
          };
          // Verify the relay message by trying to encode it with verification.
          // If it excepts it is non-finalisable
          RelayMessage.encode(relayMessage, true);
          // The message is eligible for consideration.
          finalizations.push(finalization);
        } catch (e) {
          this.logger.log(`Unparsable relay message. Ignored: ${e.message}`);
        }
      } catch (e) {
        // ignore unparsable message
        this.logger.warn(`Unparsable or non-finalisable finalization message: ${e.message}`);
      }
    }
    // consider only the first sent successful finalization
    // note that finalizations are already sorted according to the blockchain order
    const filteredFinalizations: ParsedFinalizationData[] = [];
    const encounteredSenderAddresses = new Set<Address>();
    for (const finalization of finalizations) {
      if (!encounteredSenderAddresses.has(finalization.submitAddress.toLowerCase())) {
        filteredFinalizations.push(finalization);
        encounteredSenderAddresses.add(finalization.submitAddress.toLowerCase());
      }
    }
    return filteredFinalizations;
  }

  /**
   * Prepares data for median calculation and rewarding.
   */
  protected getDataForCalculationsPartial(
    commitsAndReveals: CommitsAndReveals,
    rewardEpoch: RewardEpoch
  ): DataForCalculationsPartial {
    const eligibleCommits = new Map<Address, ICommitData>();
    const eligibleReveals = new Map<Address, IRevealData>();
    // Filter out commits from non-eligible voters
    for (const [submitAddress, commit] of commitsAndReveals.commits.entries()) {
      if (rewardEpoch.isEligibleSubmitAddress(submitAddress)) {
        eligibleCommits.set(submitAddress, commit);
      } else {
        if (!process.env.REMOVE_ANNOYING_MESSAGES) {
          this.logger.warn(`Non-eligible commit found for address ${submitAddress}`);
        }
      }
    }
    // Filter out reveals from non-eligible voters
    for (const [submitAddress, reveal] of commitsAndReveals.reveals.entries()) {
      if (rewardEpoch.isEligibleSubmitAddress(submitAddress)) {
        eligibleReveals.set(submitAddress, reveal);
      } else {
        if (!process.env.REMOVE_ANNOYING_MESSAGES) {
          this.logger.warn(`Non-eligible commit found for address ${submitAddress}`);
        }
      }
    }
    const validEligibleReveals = this.getValidReveals(
      commitsAndReveals.votingRoundId,
      eligibleCommits,
      eligibleReveals
    );
    const revealOffenders = this.getRevealOffenders(commitsAndReveals.votingRoundId, eligibleCommits, eligibleReveals);
    const voterMedianVotingWeights = new Map<Address, bigint>();
    const orderedVotersSubmissionAddresses = rewardEpoch.orderedVotersSubmitAddresses;
    const orderedVotersSubmitSignatureAddresses = rewardEpoch.orderedVotersSubmitSignatureAddresses;
    for (const submitAddress of orderedVotersSubmissionAddresses) {
      voterMedianVotingWeights.set(submitAddress, rewardEpoch.ftsoMedianVotingWeight(submitAddress));
    }

    const result: DataForCalculationsPartial = {
      votingRoundId: commitsAndReveals.votingRoundId,
      orderedVotersSubmitAddresses: orderedVotersSubmissionAddresses,
      orderedVotersSubmitSignatureAddresses,
      validEligibleReveals,
      revealOffenders,
      voterMedianVotingWeights,
      feedOrder: rewardEpoch.canonicalFeedOrder,
    };
    return result;
  }

  /**
   * Construct a mapping submissionAddress => reveal data for valid reveals of eligible voters.
   * A reveal is considered valid if there exists a matching commit.
   */
  protected getValidReveals(
    votingRoundId: number,
    eligibleCommits: Map<Address, ICommitData>,
    eligibleReveals: Map<Address, IRevealData>
  ): Map<Address, IRevealData> {
    const validEligibleReveals = new Map<Address, IRevealData>();
    for (const [submitAddress, reveal] of eligibleReveals.entries()) {
      const commit = eligibleCommits.get(submitAddress);
      if (!commit) {
        if (!process.env.REMOVE_ANNOYING_MESSAGES) {
          this.logger.debug(`No eligible commit found for address ${submitAddress}`);
        }
        continue;
      }

      const commitHash = CommitData.hashForCommit(submitAddress, votingRoundId, reveal.random, reveal.encodedValues);
      if (commit.commitHash !== commitHash) {
        this.logger.warn(
          `Invalid reveal found for address ${submitAddress}, commit: ${commit.commitHash}, reveal: ${commitHash}`
        );
        continue;
      }
      validEligibleReveals.set(submitAddress, reveal);
    }
    return validEligibleReveals;
  }

  /**
   * Construct a set of submitAddresses that incorrectly revealed or did not reveal at all.
   * Iterate over commits and check if they were revealed correctly, return those that were not.
   */
  protected getRevealOffenders(
    votingRoundId: number,
    availableCommits: Map<Address, ICommitData>,
    availableReveals: Map<Address, IRevealData>
  ): Set<Address> {
    const revealOffenders = new Set<Address>();
    for (const [submitAddress, commit] of availableCommits.entries()) {
      const reveal = availableReveals.get(submitAddress);
      if (!reveal) {
        revealOffenders.add(submitAddress);
        continue;
      }
      const commitHash = CommitData.hashForCommit(submitAddress, votingRoundId, reveal.random, reveal.encodedValues);
      if (commit.commitHash !== commitHash) {
        revealOffenders.add(submitAddress);
      }
    }
    return revealOffenders;
  }

  /**
   * Get set of all submitAddresses of reveal offenders in benching window for voting round id
   * The interval of voting rounds is defined as [@param votingRoundId - @param randomGenerationBenchingWindow, @param votingRoundId - 1]
   * A reveal offender is any voter (eligible or not), which has committed but did not reveal for a specific voting round,
   * or has provided invalid reveal (not matching to the commit).
   */
  protected async getBenchingWindowRevealOffenders(
    votingRoundId: number,
    rewardEpochId: number,
    startVotingRoundId: number,
    votingRoundIdToCommits: Map<number, SubmissionData[]>,
    votingRoundIdToReveals: Map<number, SubmissionData[]>,
    randomGenerationBenchingWindow: number,
    rewardEpochFromVotingEpochId: (votingEpochId: number) => Promise<RewardEpoch>
  ) {
    const randomOffenders = new Set<Address>();
    const genesisRewardEpoch = GENESIS_REWARD_EPOCH_START_EVENT();

    let firstBenchingRound = votingRoundId - randomGenerationBenchingWindow;

    if (
      rewardEpochId === genesisRewardEpoch.rewardEpochId + 1 &&
      votingRoundId - randomGenerationBenchingWindow < startVotingRoundId
    ) {
      firstBenchingRound = startVotingRoundId; // there are no offenders before the start of the rewardEpoch 1
    }
    for (let i = firstBenchingRound; i < votingRoundId; i++) {
      const commits = votingRoundIdToCommits.get(i) || [];
      const reveals = votingRoundIdToReveals.get(i) || [];
      if (!commits || commits.length === 0) {
        continue;
      }
      const feedOrder = (await rewardEpochFromVotingEpochId(i)).canonicalFeedOrder;
      const commitsAndReveals = this.getVoterToLastCommitAndRevealMapsForVotingRound(i, commits, reveals, feedOrder);
      const revealOffenders = this.getRevealOffenders(
        commitsAndReveals.votingRoundId,
        commitsAndReveals.commits,
        commitsAndReveals.reveals
      );
      for (const offender of revealOffenders) {
        randomOffenders.add(offender);
      }
    }
    return randomOffenders;
  }

  /**
   * Extracts commits and reveals for a single voting round from the given commit and reveal submission data array.
   * Commits and reveals are returned in the form of two maps from voter submission address to the last submission (commit or reveal, respectively)
   * ASSUMPTION 1.1: submissions in submissionDataArray are all for the same votingRoundId
   * ASSUMPTION 1.2: submissions in submissionDataArray are all commit transactions that happen in this votingRoundId
   * ASSUMPTION 1.3: submissionDataArray is ordered in the blockchain chronological order
   * ASSUMPTION 2.1: submissions in submissionDataArray are all for the same votingRoundId
   * ASSUMPTION 2.2: submissions in submissionDataArray are all reveal transactions that happen in this votingRoundId
   * ASSUMPTION 2.3: submissions in submissionDataArray all reveal transactions that happen in the correct time window (before reveal deadline)
   * ASSUMPTION 2.4: submissionDataArray is ordered in the blockchain chronological order
   * As per protocol definition, only the last valid commit and reveal for each voter is considered.
   * @param votingRoundId
   * @param commitSubmissions
   * @param revealSubmissions
   * @param feedOrder
   * @returns
   */
  protected getVoterToLastCommitAndRevealMapsForVotingRound(
    votingRoundId: number,
    commitSubmissions: SubmissionData[],
    revealSubmissions: SubmissionData[],
    feedOrder: Feed[]
  ): CommitsAndReveals {
    const commits = this.getVoterToLastCommitMap(commitSubmissions);
    const reveals = this.getVoterToLastRevealMap(revealSubmissions, feedOrder);
    return {
      votingRoundId,
      commits,
      reveals,
    };
  }

  /**
   * Creates a mapper from voter submitAddress to last commit data message for FTSO protocol and matching voting round id
   * from the given submission data array.
   * ASSUMPTION 1: submissions in submissionDataArray are all for the same votingRoundId
   * ASSUMPTION 2: submissions in submissionDataArray are all commit transactions that happen in this votingRoundId
   * ASSUMPTION 3: submissionDataArray is ordered in the blockchain chronological order
   * NOTICE: actually assumes, but does not check
   * The function must not revert, it ignores unparsable messages and logs them.
   */
  protected getVoterToLastCommitMap(submissionDataArray: SubmissionData[]): Map<Address, ICommitData> {
    const voterToLastCommit = new Map<Address, ICommitData>();
    for (const submission of submissionDataArray) {
      for (const message of submission.messages) {
        if (
          message.protocolId === FTSO2_PROTOCOL_ID &&
          message.votingRoundId === submission.votingEpochIdFromTimestamp
        ) {
          try {
            const commit = CommitData.decode(message.payload);
            voterToLastCommit.set(submission.submitAddress, commit);
          } catch (e) {
            this.logger.warn(`Unparsable commit message: ${message.payload}, error: ${errorString(e)}`);
          }
        }
      }
    }
    return voterToLastCommit;
  }

  /**
   * Create a mapper from voter submitAddress to last reveal data message for FTSO protocol and matching voting round id
   * from the given submission data array.
   * ASSUMPTION 1: submissions in submissionDataArray are all for the same votingRoundId
   * ASSUMPTION 2: submissions in submissionDataArray are all reveal transactions that happen in this votingRoundId
   * ASSUMPTION 3: submissions in submissionDataArray all reveal transactions that happen in the correct time window (before reveal deadline)
   * ASSUMPTION 4: submissionDataArray is ordered in the blockchain chronological order
   * NOTICE: actually assumes, but does not check
   * The function must not revert, it ignores unparsable messages and logs them.
   * @param submissionDataArray
   * @param feedOrder
   * @returns
   */
  protected getVoterToLastRevealMap(
    submissionDataArray: SubmissionData[],
    feedOrder: Feed[]
  ): Map<Address, IRevealData> {
    const voterToLastReveal = new Map<Address, IRevealData>();
    for (const submission of submissionDataArray) {
      for (const message of submission.messages) {
        if (
          message.protocolId === FTSO2_PROTOCOL_ID &&
          message.votingRoundId + 1 === submission.votingEpochIdFromTimestamp
        ) {
          try {
            const reveal = RevealData.decode(message.payload, feedOrder);
            voterToLastReveal.set(submission.submitAddress, reveal);
          } catch (e) {
            this.logger.warn(`Unparsable reveal message: ${message.payload}, error: ${errorString(e)}`);
          }
        }
      }
    }
    return voterToLastReveal;
  }

  /**
   * Sorts submission data array in the blockchain chronological order.
   * @param submissionDataArray
   */
  public static sortSubmissionDataArray<T>(submissionDataArray: GenericSubmissionData<T>[]) {
    submissionDataArray.sort((a, b) => {
      const order = a.blockNumber - b.blockNumber;
      if (order !== 0) {
        return order;
      }
      return a.transactionIndex - b.transactionIndex;
    });
  }

  // votingRoundId -> commit/reveal submissions
  /**
   * Creates a mapper from voting round id to submission data array for the given submission data array.
   * OPTION 1: if type is 'commit', then the mapper maps voting round id to commit submissions
   * OPTION 2: if type is 'reveal', then the mapper maps voting round id to reveal submissions
   * @param submissionEpochArray
   * @param type: "commit" | "reveal"
   */
  protected remapSubmissionDataArrayToVotingRounds(submissionEpochArray: SubmissionData[], type: "commit" | "reveal") {
    const offset = type === "commit" ? 0 : 1;
    const votingRoundIdWithOffsetToSubmission = new Map<number, SubmissionData[]>();
    for (const submission of submissionEpochArray) {
      const votingRoundId = submission.votingEpochIdFromTimestamp - offset;
      if (!votingRoundIdWithOffsetToSubmission.has(votingRoundId)) {
        votingRoundIdWithOffsetToSubmission.set(votingRoundId, []);
      }
      votingRoundIdWithOffsetToSubmission.get(votingRoundId).push(submission);
    }
    for (const submissionList of votingRoundIdWithOffsetToSubmission.values()) {
      DataManager.sortSubmissionDataArray(submissionList);
    }
    return votingRoundIdWithOffsetToSubmission;
  }

  /**
   * Filters out too late reveals.
   * @param reveals
   * @returns
   */
  protected filterRevealsByDeadlineTime(reveals: SubmissionData[]) {
    return reveals.filter(reveal => reveal.relativeTimestamp < EPOCH_SETTINGS().revealDeadlineSeconds);
  }
}
