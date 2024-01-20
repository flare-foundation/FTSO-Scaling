import { BlockAssuranceResult, IndexerClient, IndexerResponse, SubmissionData, VoterData } from "./IndexerClient";
import { RewardEpoch } from "./RewardEpoch";
import { RewardEpochManager } from "./RewardEpochManager";
import { EPOCH_SETTINGS, FTSO2_PROTOCOL_ID } from "./configs/networks";
import { CommitData, ICommitData } from "./utils/CommitData";
import { IRevealData, RevealData } from "./utils/RevealData";
import { Address, Feed } from "./voting-types";

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

interface CommitsAndReveals {
  votingRoundId: number;
  commits: Map<Address, ICommitData>;
  reveals: Map<Address, IRevealData>;
}


export interface DataForCalculationsPartial {
  votingRoundId: number;
  orderedVotersSubmissionAddresses: Address[];  
  reveals: Map<Address, IRevealData>;
  revealOffenders: Set<Address>;
  voterWeights: Map<Address, bigint>;
  feedOrder: Feed[];
}

export interface DataForCalculations extends DataForCalculationsPartial {
  randomGenerationBenchingWindow: number;
  randomOffenders: Set<Address>;
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
  reveals: Map<Address, IRevealData>;
  revealOffenders: Set<Address>;
}

interface RandomOffenders {
  randomOffenders: Set<Address>;
}

export interface VotingRoundData {
  commits: SubmissionData[]
  reveals: SubmissionData[];
}

interface CommitAndRevealSubmissionsMappingsForRange {
  votingRoundIdToCommits: Map<number, SubmissionData[]>;
  votingRoundIdToReveals: Map<number, SubmissionData[]>;
}



// * query both commits and reveals from indexer in one query (in IndexerClient) for specific voting round id
// * filter out valid commits and reveal pairs and make sure they were committed in time correct times
// * aggregate payload messages in order, filter out the ones for FTSO (ProtocolId), take last message for each voter in each votingRound
// * filter out eligible voters in current rewardEpoch (signing policy) (match submitter nad signer)
// * return array of correct reveal data for each voter in current voting round
// * return another array of offenders (no reveal or mismatch of commit and reveal)


export class DataManager {
  constructor(
    private indexerClient: IndexerClient,
    private rewardEpochManager: RewardEpochManager
  ) { }

  public async getDataForCalculations(
    votingRoundId: number,
    randomGenerationBenchingWindow: number,
    endTimeout?: number,
  ): Promise<DataMangerResponse<DataForCalculations>> {
    const startVotingRoundId = votingRoundId - randomGenerationBenchingWindow;
    const endVotingRoundId = votingRoundId;
    const mappingsResponse = await this.getCommitAndRevealMappingsForVotingRoundRange(startVotingRoundId, endVotingRoundId, endTimeout);
    if ((!endTimeout && mappingsResponse.status !== DataAvailabilityStatus.OK) || mappingsResponse.status === DataAvailabilityStatus.NOT_OK) {
      return {
        status: mappingsResponse.status,
      }
    }
    const commits = mappingsResponse.data.votingRoundIdToCommits.get(votingRoundId);
    const reveals = mappingsResponse.data.votingRoundIdToReveals.get(votingRoundId);

    const rewardEpoch = await this.rewardEpochManager.getRewardEpoch(votingRoundId);
    const commitsAndReveals = this.getCommitsAndReveals(votingRoundId, commits, reveals, rewardEpoch.canonicalFeedOrder);
    const partialData = this.getDataForCalculationsPartial(commitsAndReveals, rewardEpoch);
    const randomOffenders = await this.getRandomOffenders(mappingsResponse.data, votingRoundId, randomGenerationBenchingWindow);
    return {
      status: DataAvailabilityStatus.OK,
      data: {
        ...partialData,
        randomGenerationBenchingWindow,
        randomOffenders,
      } as DataForCalculations,
    }
  }

  private async getCommitAndRevealMappingsForVotingRoundRange(
    startVotingRoundId: number,
    endVotingRoundId: number,
    endTimeout?: number,
  ): Promise<DataMangerResponse<CommitAndRevealSubmissionsMappingsForRange>> {
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

    const votingRoundIdToCommits = this.remapSubmissionDataArrayToVotingRounds(commitSubmissionResponse.data, 0);
    const votingRoundIdToReveals = this.remapSubmissionDataArrayToVotingRounds(revealSubmissionResponse.data, 1);

    return {
      status: DataAvailabilityStatus.OK,
      data: {
        votingRoundIdToCommits,
        votingRoundIdToReveals
      }
    }
  }

  private getDataForCalculationsPartial(
    commitsAndReveals: CommitsAndReveals,
    rewardEpoch: RewardEpoch,
  ): DataForCalculationsPartial {
    const eligibleCommits = new Map<Address, ICommitData>();
    const eligibleReveals = new Map<Address, IRevealData>();
    for (const [submitAddress, commit] of commitsAndReveals.commits.entries()) {
      if (rewardEpoch.isEligibleVoterSubmissionAddress(submitAddress)) {
        eligibleCommits.set(submitAddress, commit);
      }
    }
    for (const [submitAddress, reveal] of commitsAndReveals.reveals.entries()) {
      if (rewardEpoch.isEligibleVoterSubmissionAddress(submitAddress)) {
        eligibleReveals.set(submitAddress, reveal);
      }
    }
    const reveals = new Map<Address, IRevealData>();
    for (const [submitAddress, reveal] of eligibleReveals.entries()) {
      const commit = eligibleCommits.get(submitAddress);
      if (!commit) {
        continue;
      }
      const commitHash = CommitData.hashForCommit(submitAddress, reveal.random, reveal.encodedValues);
      if (commit.commitHash !== commitHash) {
        continue;
      }
      reveals.set(submitAddress, reveal);
    }
    const revealOffenders = this.getRevealOffenders(eligibleCommits, eligibleReveals);
    const voterWeights = new Map<Address, bigint>();
    for (const [submitAddress, reveal] of reveals.entries()) {
      voterWeights.set(submitAddress, rewardEpoch.cappedWFLRDelegationWeight(submitAddress));
    }
    return {
      votingRoundId: commitsAndReveals.votingRoundId,
      orderedVotersSubmissionAddresses: rewardEpoch.orderedVotersSubmissionAddresses,
      reveals,
      revealOffenders,
      voterWeights,
      feedOrder: rewardEpoch.canonicalFeedOrder,
    } as DataForCalculationsPartial;
  }

  // * query all commits and reveals for the last X epochs (defined in benching logic)
  // * filter out commits and reveals for correct voting rounds within correct time windows
  // return list of reveal withdrawer (did commit but no reveal, or no incorrect reveal)
  private async getRandomOffenders(
    mappings: CommitAndRevealSubmissionsMappingsForRange,
    votingRoundId: number,
    randomGenerationBenchingWindow: number,
  ) {
    const randomOffenders = new Set<Address>();
    for (let i = votingRoundId - randomGenerationBenchingWindow; i < votingRoundId; i++) {

      const commits = mappings.votingRoundIdToCommits.get(i);
      const reveals = mappings.votingRoundIdToReveals.get(i);
      if (!commits || commits.length === 0) {
        continue;
      }
      const commitsAndReveals = this.getCommitsAndReveals(i, commits, reveals);
      const revealOffenders = this.getRevealOffenders(commitsAndReveals.commits, commitsAndReveals.reveals);
      for (const offender of revealOffenders) {
        randomOffenders.add(offender);
      }
    }
    return randomOffenders;
  }

  private getRevealOffenders(
    eligibleCommits: Map<Address, ICommitData>,
    eligibleReveals: Map<Address, IRevealData>,
  ): Set<Address> {
    const revealOffenders = new Set<Address>();
    for (const [submitAddress, commit] of eligibleCommits.entries()) {
      const reveal = eligibleReveals.get(submitAddress);
      if (!reveal) {
        revealOffenders.add(submitAddress);
        continue;
      }
      const commitHash = CommitData.hashForCommit(submitAddress, reveal.random, reveal.encodedValues);
      if (commit.commitHash !== commitHash) {
        revealOffenders.add(submitAddress);
      }
    }
    return revealOffenders;
  }

  // Exactly all commits and reveals for a single voting round
  /**
   * Extracts commits and reveals for a single voting round from the given commit and reveal submission data array.
   * @requires commitSubmissions and @requires revealSubmissions are all for the same votingRoundId NOTICE: actually assumes, but does not check
   * @param votingRoundId 
   * @param commitSubmissions 
   * @param revealSubmissions 
   * @param feedOrder 
   * @returns 
   */
  private getCommitsAndReveals(
    votingRoundId: number,
    commitSubmissions: SubmissionData[],
    revealSubmissions: SubmissionData[],
    feedOrder?: Feed[]
  ): CommitsAndReveals {
    const commits = this.getVoterToLastCommitMap(commitSubmissions);
    const reveals = this.getVoterToLastRevealMap(revealSubmissions, feedOrder);
    return {
      votingRoundId,
      commits,
      reveals,
    }
  }

  /**
   * Create a mapper form voter address to last commit data message for FTSO protocol from the given submission data array.
   * @requires submissionDataArray are all for the same votingRoundId NOTICE: actually assumes, but does not check
   * @param submissionDataArray 
   * @returns 
   */
  private getVoterToLastCommitMap(submissionDataArray: SubmissionData[]): Map<Address, ICommitData> {
    const voterToLastCommit = new Map<Address, ICommitData>();
    for (const submission of submissionDataArray) {
      for (const message of submission.messages) {
        if (message.protocolId === FTSO2_PROTOCOL_ID) {
          const commit = CommitData.decode(message.payload);
          voterToLastCommit.set(submission.submitAddress, commit);
        }
      }
    }
    return voterToLastCommit;
  }

  /**
   * Create a mapper form voter address to last reveal data message for FTSO protocol from the given submission data array.
   * @requires submissionDataArray are all for the same votingRoundId NOTICE: actually assumes, but does not check
   * @param submissionDataArray 
   * @param feedOrder 
   * @returns 
   */
  private getVoterToLastRevealMap(submissionDataArray: SubmissionData[], feedOrder?: Feed[]): Map<Address, IRevealData> {
    const voterToLastReveal = new Map<Address, IRevealData>();
    for (const submission of submissionDataArray) {
      for (const message of submission.messages) {
        if (message.protocolId === FTSO2_PROTOCOL_ID) {
          const reveal = RevealData.decode(message.payload, feedOrder);
          voterToLastReveal.set(submission.submitAddress, reveal);
        }
      }
    }
    return voterToLastReveal;
  }

  private sortSubmissionDataArray(submissionDataArray: SubmissionData[]) {
    submissionDataArray.sort((a, b) => {
      const order = a.blockNumber - b.blockNumber;
      if (order !== 0) {
        return order;
      }
      return a.transactionIndex - b.transactionIndex;
    });
  }

  // votingRoundId -> commit/reveal submissions
  private remapSubmissionDataArrayToVotingRounds(submissionEpochArray: SubmissionData[], offset = 0) {
    const votingRoundIdWithOffsetToSubmission = new Map<number, SubmissionData[]>();
    for (const submission of submissionEpochArray) {
      const votingRoundId = submission.votingEpochId - offset;
      if (!votingRoundIdWithOffsetToSubmission.has(votingRoundId)) {
        votingRoundIdWithOffsetToSubmission.set(votingRoundId, []);
      }
      votingRoundIdWithOffsetToSubmission.get(votingRoundId)!.push(submission);
    }
    for (const submissionList of votingRoundIdWithOffsetToSubmission.values()) {
      this.sortSubmissionDataArray(submissionList);
    }
    return votingRoundIdWithOffsetToSubmission;
  }

}
