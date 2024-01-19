import { BlockAssuranceResult, IndexerClient, IndexerResponse, SubmissionData, VoterData } from "./IndexerClient";
import { RewardEpochManager } from "./RewardEpochManager";
import { EPOCH_SETTINGS, FTSO2_PROTOCOL_ID } from "./configs/networks";
import { CommitData } from "./utils/CommitData";
import { IRevealData } from "./utils/RevealData";
import { Address, Feed, RevealData } from "./voting-types";

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

export interface DataMangerResponse<T> {
  status: DataAvailabilityStatus;
  data?: T;
}

export interface DataForCalculations {
  votingRoundId: number;
  reveals: Map<Address, IRevealData>;
  revealOffenders: Set<Address>;
  voterWeights: Map<Address, bigint>;
  feedOrder: Feed[];
  randomOffenders: Set<Address>;
}

interface ValidRevealResults {
  reveals: Map<Address, RevealData>;
  revealOffenders: Set<Address>;
}

interface RandomOffenders {
  randomOffenders: Set<Address>;
}

export interface VotingRoundData {
  commits: SubmissionData[]
  reveals: SubmissionData[];
}

export class DataManager {
  private static protocolId = FTSO2_PROTOCOL_ID

  constructor(private indexerClient: IndexerClient, private rewardEpochManager: RewardEpochManager) { }

  async dataForVotingRound(votingRoundId: number): Promise<DataForCalculations> {
    throw new Error("Not implemented");
  }

  // * query both commits and reveals from indexer in one query (in IndexerClient) for specific voting round id
  // * filter out valid commits and reveal pairs and make sure they were committed in time correct times
  // * aggregate payload messages in order, filter out the ones for FTSO (ProtocolId), take last message for each voter in each votingRound
  // * filter out eligible voters in current rewardEpoch (signing policy) (match submitter nad signer)
  // * return array of correct reveal data for each voter in current voting round
  // * return another array of offenders (no reveal or mismatch of commit and reveal)
  private async getValidRevealResults(votingRoundId: number, endTimeout?: number): Promise<DataMangerResponse<ValidRevealResults>> {

  }

  private async getSubmissionsForVotingRoundRange(
    startVotingRoundId: number,
    endVotingRoundId: number,
    endTimeout?: number,
  ): Promise<DataMangerResponse<ValidRevealResults>> {
    const commitSubmissionResponse = await this.indexerClient
      .getSubmissionDataInRange(
        "submit1",
        EPOCH_SETTINGS.votingEpochStartSec(startVotingRoundId),
        EPOCH_SETTINGS.votingEpochEndSec(endVotingRoundId),
        endTimeout
      );
    if (commitSubmissionResponse.status !== BlockAssuranceResult.OK) {
      return {
        status: DataAvailabilityStatus.NOT_OK,
      }
    }
    const revealSubmissionResponse = await this.indexerClient
      .getSubmissionDataInRange(
        "submit2",
        EPOCH_SETTINGS.votingEpochStartSec(startVotingRoundId + 1),
        EPOCH_SETTINGS.revealDeadlineSec(endVotingRoundId + 1),
        endTimeout
      );
    if (revealSubmissionResponse.status === BlockAssuranceResult.NOT_OK) {
      return {
        status: DataAvailabilityStatus.NOT_OK,
      }
    }
    const votingRoundIdToCommit = new Map<number, SubmissionData[]>();
    const votingRoundIdToReveal = new Map<number, SubmissionData[]>();
    for (const commit of commitSubmissionResponse.data) {
      const votingRoundId = commit.votingEpochId;
      if (!votingRoundIdToCommit.has(votingRoundId)) {
        votingRoundIdToCommit.set(votingRoundId, []);
      }
      votingRoundIdToCommit.get(votingRoundId)!.push(commit);
    }
    for (const reveal of revealSubmissionResponse.data) {
      const votingRoundId = reveal.votingEpochId;
      if (!votingRoundIdToReveal.has(votingRoundId)) {
        votingRoundIdToReveal.set(votingRoundId, []);
      }
      votingRoundIdToReveal.get(votingRoundId)!.push(reveal);
    }

    // Aggregate submissions by submitter address and filter out the ones with correct voting round id and protocol id
    for (let votingRoundId = startVotingRoundId; votingRoundId <= endVotingRoundId; votingRoundId++) {
      const commits = votingRoundIdToCommit.get(votingRoundId);
      const reveals = votingRoundIdToReveal.get(votingRoundId);
      const voterToVoterData = new Map<Address, VoterData>();
      commits.sort((a, b) => {
        const order = a.blockNumber - b.blockNumber;
        if (order !== 0) {
          return order;
        }
        return a.transactionIndex - b.transactionIndex;
      });
      reveals.sort((a, b) => {
        const order = a.blockNumber - b.blockNumber;
        if (order !== 0) {
          return order;
        }
        return a.transactionIndex - b.transactionIndex;
      });
      for (const commit of commits) {
        let voterData: VoterData = voterToVoterData.get(commit.submitAddress);
        if (!voterData) {
          voterData = {
            submitAddress: commit.submitAddress,
            votingRoundId: commit.votingEpochId,
          };
          voterToVoterData.set(voterData.submitAddress, voterData);
          let commitPayloadMessages = commit.messages
            .map((message) => )
            
            // CommitData.decode(message.payload))
            // .filter((message => message.protocolId === DataManager.protocolId))
        }
        // commit.messages..filter((payloadMessage) => payloadMessage.protocolId = DataManager.protocolId)
        for (const message of commit.messages) {

        }
        if (commit.protocolId !== DataManager.protocolId) {
          continue;
        }
        if (commit.votingEpochId !== votingRoundId) {
          continue;
        }
        commitsBySubmitter.set(commit.submitter, commit);
      }
      for (const reveal of reveals) {
        if (reveal.protocolId !== DataManager.protocolId) {
          continue;
        }
        if (reveal.votingEpochId !== votingRoundId) {
          continue;
        }
        revealsBySubmitter.set(reveal.submitter, reveal);
      }
      const validReveals = new Map<Address, RevealData>();
      const revealOffenders = new Set<Address>();
      for (const [submitter, commit] of commitsBySubmitter) {
        const reveal = revealsBySubmitter.get(submitter);
        if (!reveal) {
          revealOffenders.add(submitter);
          continue;
        }
        if (commit.payload !== reveal.payload) {
          revealOffenders.add(submitter);
          continue;
        }
        validReveals.set(submitter, reveal);
      }
      votingRoundIdToCommit.set(votingRoundId, validReveals);
      votingRoundIdToReveal.set(votingRoundId, revealOffenders);
    }

  }
  // * query all commits and reveals for the last X epochs (defined in benching logic)
  // * filter out commits and reveals for correct voting rounds within correct time windows
  // return list of reveal withdrawer (did commit but no reveal, or no incorrect reveal)
  private async getRevealOffenders(
    votingRoundId: number,
    offendingRange: number
  ): Promise<DataMangerResponse<RandomOffenders>> {
    throw new Error("Not implemented");
  }

  //   /**
  //    * Returns submit1 transactions that were submitted in a given voting round.
  //    * @param votingRoundId
  //    * @param endTimeout
  //    * @returns
  //    */
  //   async getCommitsDataForVotingRoundId(
  //     votingEpochId: number,
  //     endTimeout?: number
  //   ): Promise<IndexerResponse<SubmissionData[]>> {
  //     const startTime = EPOCH_SETTINGS.votingEpochStartSec(votingEpochId);
  //     const endTime = EPOCH_SETTINGS.votingEpochEndSec(votingEpochId);
  //     return this.indexerClient.getSubmissionDataInRange("submit1", startTime, endTime, endTimeout);
  //   }

  //   async getRevealsDataForVotingEpoch(
  //     votingEpochId: number,
  //     endTimeout?: number
  //   ): Promise<IndexerResponse<SubmissionData[]>> {
  //     const startTime = EPOCH_SETTINGS.votingEpochStartSec(votingEpochId);
  //     const endTime = EPOCH_SETTINGS.revealDeadlineSec(votingEpochId);
  //     return this.getSubmissionDataInRange("submit2", startTime, endTime, endTimeout);
  //   }

  //   async getCommitAndRevealDataForVotingEpochRange(
  //     startVotingRoundId: number,
  //     endVotingRoundId: number,
  //     endTimeout?: number
  //   ): Promise<IndexerResponse<{ commits: SubmissionData[]; reveals: SubmissionData[] }>> {
  //     const submit1Start = EPOCH_SETTINGS.votingEpochStartSec(startVotingRoundId - 1);
  //     const submit1End = EPOCH_SETTINGS.votingEpochEndSec(endVotingRoundId - 1);

  //     const submit2Start = EPOCH_SETTINGS.votingEpochStartSec(startVotingRoundId);
  //     const submit2End = EPOCH_SETTINGS.revealDeadlineSec(endVotingRoundId);

  //     const commitData = await this.getSubmissionDataInRange("submit1", submit1Start, submit1End, endTimeout);
  //     const revealDataRaw = await this.getSubmissionDataInRange("submit2", submit2Start, submit2End, endTimeout);

  //     const revealData = revealDataRaw.data?.filter(
  //       submit => submit.relativeTimestamp < EPOCH_SETTINGS.revealDeadlineSeconds
  //     );

  //     if (commitData.status !== BlockAssuranceResult.OK || revealDataRaw.status !== BlockAssuranceResult.OK) {
  //       if (commitData.status === BlockAssuranceResult.NOT_OK || revealDataRaw.status === BlockAssuranceResult.NOT_OK) {
  //         return {
  //           status: BlockAssuranceResult.NOT_OK,
  //         };
  //       }
  //       return {
  //         status: BlockAssuranceResult.TIMEOUT_OK,
  //       };
  //     }

  //     return {
  //       status: BlockAssuranceResult.OK,
  //       data: {
  //         commits: commitData.data,
  //         reveals: revealData,
  //       },
  //     };
  //   }
}
