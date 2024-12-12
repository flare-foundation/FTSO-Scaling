import { ECDSASignature } from "../../fsp-utils/src/ECDSASignature";
import { ProtocolMessageMerkleRoot } from "../../fsp-utils/src/ProtocolMessageMerkleRoot";
import { RelayMessage } from "../../fsp-utils/src/RelayMessage";
import { ISignaturePayload, SignaturePayload } from "../../fsp-utils/src/SignaturePayload";
import { DataAvailabilityStatus, DataManager, DataMangerResponse, SignAndFinalizeSubmissionData } from "./DataManager";
import { BlockAssuranceResult, GenericSubmissionData, SubmissionData } from "./IndexerClient";
import { IndexerClientForRewarding } from "./IndexerClientForRewarding";
import { RewardEpoch } from "./RewardEpoch";
import { RewardEpochManager } from "./RewardEpochManager";
import { ContractMethodNames } from "./configs/contracts";
import { ADDITIONAL_REWARDED_FINALIZATION_WINDOWS, EPOCH_SETTINGS, FDC_PROTOCOL_ID, FTSO2_PROTOCOL_ID, WRONG_SIGNATURE_INDICATOR_MESSAGE_HASH } from "./configs/networks";
import {
  DataForCalculations,
  DataForRewardCalculation,
  FDCDataForVotingRound,
  FDCRewardData,
  FastUpdatesDataForVotingRound,
  PartialFDCDataForVotingRound
} from "./data-calculation-interfaces";
import { bitVoteIndicesNum, extractFDCRewardData, uniqueRequestsIndices } from "./reward-calculation/fdc/fdc-utils";
import { ILogger } from "./utils/ILogger";
import { errorString } from "./utils/error";
import { Address, MessageHash } from "./voting-types";

/**
 * Helps in extracting data in a consistent way for FTSO scaling feed median calculations, random number calculation and rewarding.
 * It uses indexerClient to query data from c chain indexer database
 * It uses rewardEpochManager to get correct reward epoch configuration for a given voting round id
 * It uses EPOCH_SETTINGS to get manage timestamp to voting round id conversions
 */
export class DataManagerForRewarding extends DataManager {
  constructor(
    protected readonly indexerClient: IndexerClientForRewarding,
    protected readonly rewardEpochManager: RewardEpochManager,
    protected readonly logger: ILogger
  ) {
    super(indexerClient, rewardEpochManager, logger);
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
    const signatures = DataManagerForRewarding.extractSignatures(
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
   * Prepare data for median calculation and rewarding given the voting round id and the random generation benching window.
   *  - queries relevant commits and reveals from chain indexer database
   *  - filters out leaving valid and matching commits and reveals pairs
   *  - filters out leaving commits and reveals by eligible voters in the current reward epoch
   *  - calculates reveal offenders in the voting round id
   *  - calculates all reveal offenders in the random generation benching window (@param votingRoundId - @param randomGenerationBenchingWindow, @param votingRoundId - 1)
   */
  public async getDataForCalculationsForVotingRoundRange(
    firstVotingRoundId: number,
    lastVotingRoundId: number,
    randomGenerationBenchingWindow: number,
    endTimeout?: number
  ): Promise<DataMangerResponse<DataForCalculations[]>> {
    const startVotingRoundId = firstVotingRoundId - randomGenerationBenchingWindow;
    const endVotingRoundId = lastVotingRoundId;
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
    const result: DataForCalculations[] = [];
    const firstRewardEpoch = await this.rewardEpochManager.getRewardEpochForVotingEpochId(startVotingRoundId);
    const lastRewardEpoch = await this.rewardEpochManager.getRewardEpochForVotingEpochId(endVotingRoundId);
    if (!firstRewardEpoch || !lastRewardEpoch) {
      this.logger.warn(`No reward epoch found for voting round range ${startVotingRoundId} - ${endVotingRoundId}`);
      return {
        status: DataAvailabilityStatus.NOT_OK,
      };
    }
    if (lastRewardEpoch.rewardEpochId - firstRewardEpoch.rewardEpochId > 1) {
      this.logger.warn(
        `Reward epochs are not consecutive for voting round range ${startVotingRoundId} - ${endVotingRoundId}`
      );
      return {
        status: DataAvailabilityStatus.NOT_OK,
      };
    }

    async function rewardEpochForVotingRoundId(votingRoundId: number): Promise<RewardEpoch> {
      if (votingRoundId < lastRewardEpoch.startVotingRoundId) {
        return firstRewardEpoch;
      }
      return lastRewardEpoch;
    }

    for (let votingRoundId = firstVotingRoundId; votingRoundId <= lastVotingRoundId; votingRoundId++) {
      //////// FTSO Scaling ////////
      const commits = mappingsResponse.data.votingRoundIdToCommits.get(votingRoundId) || [];
      const reveals = mappingsResponse.data.votingRoundIdToReveals.get(votingRoundId) || [];
      // this.logger.debug(`Commits for voting round ${votingRoundId}: ${JSON.stringify(commits)}`);
      // this.logger.debug(`Reveals for voting round ${votingRoundId}: ${JSON.stringify(reveals)}`);

      const rewardEpoch = await rewardEpochForVotingRoundId(votingRoundId);
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
        (votingRoundId: number) => rewardEpochForVotingRoundId(votingRoundId)
      );
      if (!process.env.REMOVE_ANNOYING_MESSAGES) {
        this.logger.debug(`Valid reveals from: ${JSON.stringify(Array.from(partialData.validEligibleReveals.keys()))}`);
      }
      //////// FDC ////////
      const validEligibleBitVotes: SubmissionData[] = this.extractSubmissionsWithValidEligibleBitVotes(reveals, rewardEpoch);
      const dataForRound = {
        ...partialData,
        randomGenerationBenchingWindow,
        benchingWindowRevealOffenders,
        rewardEpoch,
        validEligibleBitVoteSubmissions: validEligibleBitVotes
      } as DataForCalculations;
      result.push(dataForRound);
    }
    return {
      status: mappingsResponse.status,
      data: result as DataForCalculations[],
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
          if (signaturePayload.message && signaturePayload.message.protocolId !== message.protocolId) {
            throw new Error(`Protocol id mismatch in signed message. Expected ${message.protocolId}, got ${signaturePayload.message.protocolId}`);
          }
          if (signaturePayload.message && signaturePayload.message.votingRoundId !== message.votingRoundId) {
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
  public async getDataForRewardCalculationForVotingRoundRange(
    firstVotingRoundId: number,
    lastVotingRoundId: number,
    randomGenerationBenchingWindow: number,
    useFastUpdatesData: boolean,
    useFDCData: boolean
  ): Promise<DataMangerResponse<DataForRewardCalculation[]>> {
    const dataForCalculationsResponse = await this.getDataForCalculationsForVotingRoundRange(
      firstVotingRoundId,
      lastVotingRoundId,
      randomGenerationBenchingWindow
    );
    if (dataForCalculationsResponse.status !== DataAvailabilityStatus.OK) {
      return {
        status: dataForCalculationsResponse.status,
      };
    }
    const signaturesResponse = await this.getSignAndFinalizeSubmissionDataForVotingRoundRange(
      firstVotingRoundId,
      lastVotingRoundId
    );
    if (signaturesResponse.status !== DataAvailabilityStatus.OK) {
      return {
        status: signaturesResponse.status,
      };
    }
    let fastUpdatesData: FastUpdatesDataForVotingRound[] = [];
    let partialFdcData: PartialFDCDataForVotingRound[] = [];

    if (useFastUpdatesData) {
      const fastUpdatesDataResponse = await this.getFastUpdatesDataForVotingRoundRange(
        firstVotingRoundId,
        lastVotingRoundId
      );
      if (fastUpdatesDataResponse.status !== DataAvailabilityStatus.OK) {
        return {
          status: fastUpdatesDataResponse.status,
        };
      }
      fastUpdatesData = fastUpdatesDataResponse.data;
    }
    if (useFDCData) {
      const partialFdcDataResponse = await this.getFDCDataForVotingRoundRange(
        firstVotingRoundId,
        lastVotingRoundId
      );
      if (partialFdcDataResponse.status !== DataAvailabilityStatus.OK) {
        return {
          status: partialFdcDataResponse.status,
        };
      }
      partialFdcData = partialFdcDataResponse.data;
    }

    const result: DataForRewardCalculation[] = [];
    let startIndexSignatures = 0;
    let endIndexSignatures = 0;
    let startIndexFinalizations = 0;
    let endIndexFinalizations = 0;
    for (let votingRoundId = firstVotingRoundId; votingRoundId <= lastVotingRoundId; votingRoundId++) {
      const startTime = EPOCH_SETTINGS().revealDeadlineSec(votingRoundId + 1) + 1;
      const endTime = EPOCH_SETTINGS().votingEpochEndSec(votingRoundId + 1 + ADDITIONAL_REWARDED_FINALIZATION_WINDOWS);
      while (
        startIndexSignatures < signaturesResponse.data.signatures.length &&
        signaturesResponse.data.signatures[startIndexSignatures].timestamp < startTime
      ) {
        startIndexSignatures++;
      }
      while (
        endIndexSignatures < signaturesResponse.data.signatures.length &&
        signaturesResponse.data.signatures[endIndexSignatures].timestamp <= endTime
      ) {
        endIndexSignatures++;
      }
      while (
        startIndexFinalizations < signaturesResponse.data.finalizations.length &&
        signaturesResponse.data.finalizations[startIndexFinalizations].timestamp < startTime
      ) {
        startIndexFinalizations++;
      }
      while (
        endIndexFinalizations < signaturesResponse.data.finalizations.length &&
        signaturesResponse.data.finalizations[endIndexFinalizations].timestamp <= endTime
      ) {
        endIndexFinalizations++;
      }

      const dataForCalculations = dataForCalculationsResponse.data[votingRoundId - firstVotingRoundId];
      const rewardEpoch = dataForCalculations.rewardEpoch;
      const votingRoundSignatures = signaturesResponse.data.signatures.slice(startIndexSignatures, endIndexSignatures);
      const votingRoundFinalizations = signaturesResponse.data.finalizations.slice(
        startIndexFinalizations,
        endIndexFinalizations
      );
      const signatures = DataManagerForRewarding.extractSignatures(
        votingRoundId,
        rewardEpoch,
        votingRoundSignatures,
        FTSO2_PROTOCOL_ID,
        undefined,
        this.logger
      );
      const finalizations = this.extractFinalizations(
        votingRoundId,
        rewardEpoch,
        votingRoundFinalizations,
        FTSO2_PROTOCOL_ID
      );
      const firstSuccessfulFinalization = finalizations.find(finalization => finalization.successfulOnChain);

      let fdcData: FDCDataForVotingRound | undefined;
      let fdcRewardData: FDCRewardData | undefined;
      let consensusBitVoteIndices: number[] = [];

      if (useFDCData) {
        const fdcFinalizations = this.extractFinalizations(
          votingRoundId,
          rewardEpoch,
          votingRoundFinalizations,
          FDC_PROTOCOL_ID
        );
        const fdcFirstSuccessfulFinalization = fdcFinalizations.find(finalization => finalization.successfulOnChain);
        let fdcSignatures = new Map<MessageHash, GenericSubmissionData<ISignaturePayload>[]>;
        if (fdcFirstSuccessfulFinalization) {
          if (!fdcFirstSuccessfulFinalization.messages.protocolMessageMerkleRoot) {
            throw new Error(`Protocol message merkle root is missing for FDC finalization ${fdcFirstSuccessfulFinalization.messages.protocolMessageHash}`);
          }
          RelayMessage.augment(fdcFirstSuccessfulFinalization.messages);
          const consensusMessageHash = fdcFirstSuccessfulFinalization.messages.protocolMessageHash;
          fdcSignatures = DataManagerForRewarding.extractSignatures(
            votingRoundId,
            rewardEpoch,
            votingRoundSignatures,
            FDC_PROTOCOL_ID,
            consensusMessageHash,
            this.logger
          );
          fdcRewardData = extractFDCRewardData(
            consensusMessageHash,
            dataForCalculations.validEligibleBitVoteSubmissions,
            fdcSignatures,
            rewardEpoch
          )
        }

        const partialData = partialFdcData[votingRoundId - firstVotingRoundId];
        if (partialData.votingRoundId !== votingRoundId) {
          throw new Error(`Voting round id mismatch: ${partialData.votingRoundId} !== ${votingRoundId}`);
        }
        if (partialData && partialData.nonDuplicationIndices && fdcRewardData && fdcRewardData.consensusBitVote !== undefined) {
          consensusBitVoteIndices = bitVoteIndicesNum(fdcRewardData.consensusBitVote, partialData.nonDuplicationIndices.length);
          for (const bitVoteIndex of consensusBitVoteIndices) {
            for (const [i, originalIndex] of partialData.nonDuplicationIndices[bitVoteIndex].entries()) {
              partialData.attestationRequests[originalIndex].confirmed = true;
              partialData.attestationRequests[originalIndex].duplicate = i > 0;
            }
          }
        }
        fdcData = {
          ...partialData,
          bitVotes: dataForCalculations.validEligibleBitVoteSubmissions,
          signaturesMap: fdcSignatures,
          finalizations: fdcFinalizations,
          firstSuccessfulFinalization: fdcFirstSuccessfulFinalization,
          ...fdcRewardData,
          consensusBitVoteIndices,
        }
      }

      const dataForRound: DataForRewardCalculation = {
        dataForCalculations,
        signatures,
        finalizations,
        firstSuccessfulFinalization,
        fastUpdatesData: fastUpdatesData[votingRoundId - firstVotingRoundId],
        fdcData
      };
      result.push(dataForRound);
    }
    return {
      status: DataAvailabilityStatus.OK,
      data: result,
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
  protected async getSignAndFinalizeSubmissionDataForVotingRoundRange(
    firstVotingRoundId: number,
    lastVotingRoundId: number
  ): Promise<DataMangerResponse<SignAndFinalizeSubmissionData>> {
    const submitSignaturesSubmissionResponse = await this.indexerClient.getSubmissionDataInRange(
      ContractMethodNames.submitSignatures,
      EPOCH_SETTINGS().revealDeadlineSec(firstVotingRoundId + 1) + 1,
      EPOCH_SETTINGS().votingEpochEndSec(lastVotingRoundId + 1 + ADDITIONAL_REWARDED_FINALIZATION_WINDOWS)
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
      EPOCH_SETTINGS().revealDeadlineSec(firstVotingRoundId + 1) + 1,
      EPOCH_SETTINGS().votingEpochEndSec(lastVotingRoundId + 1 + ADDITIONAL_REWARDED_FINALIZATION_WINDOWS)
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

  public async getFastUpdatesDataForVotingRoundRange(
    firstVotingRoundId: number,
    lastVotingRoundId: number
  ): Promise<DataMangerResponse<FastUpdatesDataForVotingRound[]>> {
    const feedValuesResponse = await this.indexerClient.getFastUpdateFeedsEvents(firstVotingRoundId, lastVotingRoundId);
    if (feedValuesResponse.status !== BlockAssuranceResult.OK) {
      return {
        status: DataAvailabilityStatus.NOT_OK,
      };
    }
    const feedUpdates = await this.indexerClient.getFastUpdateFeedsSubmittedEvents(
      firstVotingRoundId,
      lastVotingRoundId
    );
    if (feedUpdates.status !== BlockAssuranceResult.OK) {
      return {
        status: DataAvailabilityStatus.NOT_OK,
      };
    }
    const result: FastUpdatesDataForVotingRound[] = [];
    for (let votingRoundId = firstVotingRoundId; votingRoundId <= lastVotingRoundId; votingRoundId++) {
      const fastUpdateFeeds = feedValuesResponse.data[votingRoundId - firstVotingRoundId];
      const fastUpdateSubmissions = feedUpdates.data[votingRoundId - firstVotingRoundId];
      // Handles the 'undefined' value in fastUpdateFeeds - this can happen on FastUpdater contract change
      if (!fastUpdateFeeds) {
        throw new Error(`FastUpdateFeeds is undefined for voting round ${votingRoundId}`);
      }

      if (fastUpdateFeeds as any === "CONTRACT_CHANGE") {
        result.push(undefined);
        this.logger.error(`WARN: FastUpdateFeeds contract change for voting round ${votingRoundId}`);
        continue;
      }
      const value: FastUpdatesDataForVotingRound = {
        votingRoundId,
        feedValues: fastUpdateFeeds.feeds,
        feedDecimals: fastUpdateFeeds.decimals,
        signingPolicyAddressesSubmitted: fastUpdateSubmissions.map(submission => submission.signingPolicyAddress),
      };
      result.push(value);
    }
    return {
      status: DataAvailabilityStatus.OK,
      data: result,
    };
  }

  public async getFDCDataForVotingRoundRange(
    firstVotingRoundId: number,
    lastVotingRoundId: number
  ): Promise<DataMangerResponse<PartialFDCDataForVotingRound[]>> {

    const attestationRequestsResponse = await this.indexerClient.getAttestationRequestEvents(firstVotingRoundId, lastVotingRoundId);
    if (attestationRequestsResponse.status !== BlockAssuranceResult.OK) {
      return {
        status: DataAvailabilityStatus.NOT_OK,
      };
    }
    const result: PartialFDCDataForVotingRound[] = [];
    for (let votingRoundId = firstVotingRoundId; votingRoundId <= lastVotingRoundId; votingRoundId++) {
      const attestationRequests = attestationRequestsResponse.data[votingRoundId - firstVotingRoundId];
      const value: PartialFDCDataForVotingRound = {
        votingRoundId,
        attestationRequests,
        nonDuplicationIndices: uniqueRequestsIndices(attestationRequests),
      };
      result.push(value);
    }
    return {
      status: DataAvailabilityStatus.OK,
      data: result,
    };
  }

  /**
   * Extracts all submissions that have in payload a valid eligible bit vote for the given reward epoch.
   * Note that payloads may contain messages from other protocols!
   * If data provider submits multiple bitvotes, the last submission is considered
   */
  public extractSubmissionsWithValidEligibleBitVotes(submissionDataArray: SubmissionData[], rewardEpoch: RewardEpoch): SubmissionData[] {
    const voterToLastBitVote = new Map<Address, SubmissionData>();
    for (const submission of submissionDataArray) {
      for (const message of submission.messages) {
        if (
          message.protocolId === FDC_PROTOCOL_ID &&
          message.votingRoundId + 1 === submission.votingEpochIdFromTimestamp
        ) {
          try {
            const submitAddress = submission.submitAddress.toLowerCase();
            if (rewardEpoch.isEligibleSubmitAddress(submitAddress)) {
              voterToLastBitVote.set(submitAddress, submission);
            } else {
              if (!process.env.REMOVE_ANNOYING_MESSAGES) {
                this.logger.warn(`Non-eligible submit1 found for address ${submitAddress}`);
              }
            }
          } catch (e) {
            this.logger.warn(`Unparsable reveal message: ${message.payload}, error: ${errorString(e)}`);
          }
        }
      }
    }
    return [...voterToLastBitVote.values()];
  }

}
