import { IndexerClient, IndexerResponse, SubmissionData } from "./IndexerClient";
import { RewardEpochManager } from "./RewardEpochManager";
import { EPOCH_SETTINGS } from "./configs/networks";
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

export class DataManager {
  constructor(private indexerClient: IndexerClient, private rewardEpochManager: RewardEpochManager) {}

  async dataForVotingRound(votingRoundId: number): Promise<DataForCalculations> {
    throw new Error("Not implemented");
  }

  // * query both commits and reveals from indexer in one query (in IndexerClient) for specific voting round id
  // * filter out valid commits and reveal pairs and make sure they were committed in time correct times
  // * aggregate payload messages in order, filter out the ones for FTSO (ProtocolId), take last message for each voter in each votingRound
  // * filter out eligible voters in current rewardEpoch (signing policy) (match submitter nad signer)
  // * return array of correct reveal data for each voter in current voting round
  // * return another array of offenders (no reveal or mismatch of commit and reveal)
  private async getValidRevealResults(votingRoundId: number): Promise<DataMangerResponse<ValidRevealResults>> {
    throw new Error("Not implemented");
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
