import { IndexerClient } from "./IndexerClient";
import { RewardEpochManager } from "./RewardEpochManager";

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


export class DataManager {
   constructor(
      private indexerClient: IndexerClient,
      private rewardEpochManager: RewardEpochManager
   ) { }

   /**
    * Returns submit1 transactions that were submitted in a given voting round.
    * @param votingRoundId 
    * @param endTimeout 
    * @returns 
    */
   async getCommitsDataForVotingRoundId(
      votingEpochId: number,
      endTimeout?: number
   ): Promise<IndexerResponse<SubmissionData[]>> {
      const startTime = EPOCH_SETTINGS.votingEpochStartSec(votingEpochId);
      const endTime = EPOCH_SETTINGS.votingEpochEndSec(votingEpochId);
      return this.getSubmissionDataInRange("submit1", startTime, endTime, endTimeout);
   }

   async getRevealsDataForVotingEpoch(
      votingEpochId: number,
      endTimeout?: number
   ): Promise<IndexerResponse<SubmissionData[]>> {
      const startTime = EPOCH_SETTINGS.votingEpochStartSec(votingEpochId);
      const endTime = EPOCH_SETTINGS.revealDeadlineSec(votingEpochId);
      return this.getSubmissionDataInRange("submit2", startTime, endTime, endTimeout);
   }

   async getCommitAndRevealDataForVotingEpochRange(
      startVotingRoundId: number,
      endVotingRoundId: number,
      endTimeout?: number
   ): Promise<IndexerResponse<{ commits: SubmissionData[]; reveals: SubmissionData[] }>> {
      const submit1Start = EPOCH_SETTINGS.votingEpochStartSec(startVotingRoundId - 1);
      const submit1End = EPOCH_SETTINGS.votingEpochEndSec(endVotingRoundId - 1);

      const submit2Start = EPOCH_SETTINGS.votingEpochStartSec(startVotingRoundId);
      const submit2End = EPOCH_SETTINGS.revealDeadlineSec(endVotingRoundId);

      const commitData = await this.getSubmissionDataInRange("submit1", submit1Start, submit1End, endTimeout);
      const revealDataRaw = await this.getSubmissionDataInRange("submit2", submit2Start, submit2End, endTimeout);

      const revealData = revealDataRaw.data?.filter(submit => submit.relativeTimestamp < EPOCH_SETTINGS.revealDeadlineSeconds);

      if (commitData.status !== BlockAssuranceResult.OK || revealDataRaw.status !== BlockAssuranceResult.OK) {
         if (commitData.status === BlockAssuranceResult.NOT_OK || revealDataRaw.status === BlockAssuranceResult.NOT_OK) {
            return {
               status: BlockAssuranceResult.NOT_OK,
            };
         }
         return {
            status: BlockAssuranceResult.TIMEOUT_OK,
         };
      }

      return {
         status: BlockAssuranceResult.OK,
         data: {
            commits: commitData.data,
            reveals: revealData,
         }
      };
   }


}