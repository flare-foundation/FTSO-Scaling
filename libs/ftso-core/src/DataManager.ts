import { BlockAssuranceResult, IndexerClient, SubmissionData } from "./IndexerClient";
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
  // voting round id
  votingRoundId: number;
  // Ordered list of submission addresses matching the order in the signing policy
  orderedVotersSubmissionAddresses: Address[];
  // Reveals from eligible submission addresses that match to existing commits
  validEligibleReveals: Map<Address, IRevealData>;
  // Submission addresses of eligible voters that committed but withheld or provided wrong reveals in the voting round
  revealOffenders: Set<Address>;
  // Median voting weight
  voterMedianVotingWeights: Map<Address, bigint>;
  // Rewarding weights
  voterRewardingWeights: Map<Address, bigint>;
  // Feed order for the reward epoch of the voting round id
  feedOrder: Feed[];
}

export interface DataForCalculations extends DataForCalculationsPartial {
  // Window in which offenses related to reveal withholding or providing wrong reveals are counted
  randomGenerationBenchingWindow: number;
  // Set of offending submission addresses in the randomGenerationBenchingWindow
  benchingWindowRevealOffenders: Set<Address>;
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

/**
 * Helps in extracting data in a consistent way for FTSO scaling feed median calculations, random number calculation and rewarding.
 * It uses indexerClient to query data from c chain indexer database
 * It uses rewardEpochManager to get correct reward epoch configuration for a given voting round id
 * It uses EPOCH_SETTINGS to get manage timestamp to voting round id conversions
 */
export class DataManager {
  constructor(private indexerClient: IndexerClient, private rewardEpochManager: RewardEpochManager) {}

  /**
   * Prepare data for median calculation and rewarding given the voting round id and the random generation benching window.
   *  - queries relevant commits and reveals from chain indexer database
   *  - filters out leaving valid and matching commits and reveals pairs 
   *  - filters out leaving commits and reveals by eligible voters in the current reward epoch
   *  - calculates reveal offenders in the voting round id
   *  - calculates all reveal offenders in the random generation benching window (@param votingRoundId - @param randomGenerationBenchingWindow, @param votingRoundId - 1)
   * @param votingRoundId 
   * @param randomGenerationBenchingWindow 
   * @param endTimeout 
   * @returns 
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
      return {
        status: mappingsResponse.status,
      };
    }
    const commits = mappingsResponse.data.votingRoundIdToCommits.get(votingRoundId);
    const reveals = mappingsResponse.data.votingRoundIdToReveals.get(votingRoundId);

    const rewardEpoch = await this.rewardEpochManager.getRewardEpoch(votingRoundId);
    if (!rewardEpoch) {
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
      mappingsResponse.data.votingRoundIdToCommits,
      mappingsResponse.data.votingRoundIdToReveals,
      randomGenerationBenchingWindow
    );
    return {
      status: mappingsResponse.status,
      data: {
        ...partialData,
        randomGenerationBenchingWindow,
        benchingWindowRevealOffenders,
      } as DataForCalculations,
    };
  }

  /**
   * Creates a pair of mappings
   * 1. votingRoundId -> commit submissions, chronologically ordered
   * 2. votingRoundId -> reveal submissions, chronologically ordered, to late filtered out
   * It covers all voting rounds in the given range. For each voting round id it
   * ensures that exactly all commit and reveal submissions are present and ordered
   * also ensures that all reveal happen in the correct time windows
   * in blockchain chronological order.
   * @param startVotingRoundId
   * @param endVotingRoundId
   * @param endTimeout
   * @returns
   */
  private async getCommitAndRevealMappingsForVotingRoundRange(
    startVotingRoundId: number,
    endVotingRoundId: number,
    endTimeout?: number
  ): Promise<DataMangerResponse<CommitAndRevealSubmissionsMappingsForRange>> {
    const commitSubmissionResponse = await this.indexerClient.getSubmissionDataInRange(
      "submit1",
      EPOCH_SETTINGS.votingEpochStartSec(startVotingRoundId),
      EPOCH_SETTINGS.votingEpochEndSec(endVotingRoundId)
    );
    // Timeout is only considered when querying the reveals data which come later
    if (commitSubmissionResponse.status !== BlockAssuranceResult.OK) {
      return {
        status: DataAvailabilityStatus.NOT_OK,
      };
    }
    const revealSubmissionResponse = await this.indexerClient.getSubmissionDataInRange(
      "submit2",
      EPOCH_SETTINGS.votingEpochStartSec(startVotingRoundId + 1),
      EPOCH_SETTINGS.revealDeadlineSec(endVotingRoundId + 1),
      endTimeout
    );
    if (revealSubmissionResponse.status === BlockAssuranceResult.NOT_OK) {
      return {
        status: DataAvailabilityStatus.NOT_OK,
      };
    }
    if (revealSubmissionResponse.status === BlockAssuranceResult.TIMEOUT_OK) {
      // USELOGER
      console.warn("Used revels data with timeout assumption on indexer client. TIMEOUT_OK");
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
   * Prepares data for median calculation and rewarding.
   * @param commitsAndReveals
   * @param rewardEpoch
   * @returns
   */
  private getDataForCalculationsPartial(
    commitsAndReveals: CommitsAndReveals,
    rewardEpoch: RewardEpoch
  ): DataForCalculationsPartial {
    const eligibleCommits = new Map<Address, ICommitData>();
    const eligibleReveals = new Map<Address, IRevealData>();
    // Filter out commits from non-eligible voters
    for (const [submitAddress, commit] of commitsAndReveals.commits.entries()) {
      if (rewardEpoch.isEligibleVoterSubmissionAddress(submitAddress)) {
        eligibleCommits.set(submitAddress, commit);
      }
    }
    // Filter out reveals from non-eligible voters
    for (const [submitAddress, reveal] of commitsAndReveals.reveals.entries()) {
      if (rewardEpoch.isEligibleVoterSubmissionAddress(submitAddress)) {
        eligibleReveals.set(submitAddress, reveal);
      }
    }
    const validEligibleReveals = this.getValidReveals(eligibleCommits, eligibleReveals);
    const revealOffenders = this.getRevealOffenders(eligibleCommits, eligibleReveals);
    const voterMedianVotingWeights = new Map<Address, bigint>();
    const voterRewardingWeights = new Map<Address, bigint>();
    const orderedVotersSubmissionAddresses = rewardEpoch.orderedVotersSubmissionAddresses;
    for (const submitAddress of orderedVotersSubmissionAddresses) {
      voterMedianVotingWeights.set(submitAddress, rewardEpoch.ftsoMedianVotingWeight(submitAddress));
      voterRewardingWeights.set(submitAddress, rewardEpoch.ftsoRewardingWeight(submitAddress));
    }

    const result: DataForCalculationsPartial = {
      votingRoundId: commitsAndReveals.votingRoundId,
      orderedVotersSubmissionAddresses,
      validEligibleReveals,
      revealOffenders,
      voterMedianVotingWeights,
      voterRewardingWeights,
      feedOrder: rewardEpoch.canonicalFeedOrder,
    };
    return result;
  }

  /**
   * Construct a mapping submissionAddress => reveal data for valid reveals of eligible voters.
   * A reveal is considered valid if there exists a matching commit.
   * @param eligibleCommits
   * @param eligibleReveals
   * @returns
   */
  private getValidReveals(
    eligibleCommits: Map<Address, ICommitData>,
    eligibleReveals: Map<Address, IRevealData>
  ): Map<Address, IRevealData> {
    const validEligibleReveals = new Map<Address, IRevealData>();
    for (const [submitAddress, reveal] of eligibleReveals.entries()) {
      const commit = eligibleCommits.get(submitAddress);
      if (!commit) {
        continue;
      }
      const commitHash = CommitData.hashForCommit(submitAddress, reveal.random, reveal.encodedValues);
      if (commit.commitHash !== commitHash) {
        continue;
      }
      validEligibleReveals.set(submitAddress, reveal);
    }
    return validEligibleReveals;
  }

  /**
   * Construct a set of submission addresses that incorrectly revealed or did not reveal at all.
   * Iterate over commits and check if they were revealed correctly., return those that were not.
   * @param availableCommits
   * @param availableReveals
   * @returns
   */
  private getRevealOffenders(
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
      const commitHash = CommitData.hashForCommit(submitAddress, reveal.random, reveal.encodedValues);
      if (commit.commitHash !== commitHash) {
        revealOffenders.add(submitAddress);
      }
    }
    return revealOffenders;
  }

  /**
   * Get set of all reveal offenders in benching window for voting round id
   * The interval of voting rounds is defined as [@param votingRoundId - @param randomGenerationBenchingWindow, @param votingRoundId - 1]
   * A reveal offender is any voter (eligible or not), which has committed but did not reveal for a specific voting round,
   * or has provided invalid reveal (not matching to the commit)
   * @param votingRoundId
   * @param votingRoundIdToCommits
   * @param votingRoundIdToReveals
   * @param randomGenerationBenchingWindow
   * @returns
   */
  private async getBenchingWindowRevealOffenders(
    votingRoundId: number,
    votingRoundIdToCommits: Map<number, SubmissionData[]>,
    votingRoundIdToReveals: Map<number, SubmissionData[]>,
    randomGenerationBenchingWindow: number
  ) {
    const randomOffenders = new Set<Address>();
    for (let i = votingRoundId - randomGenerationBenchingWindow; i < votingRoundId; i++) {
      const commits = votingRoundIdToCommits.get(i);
      const reveals = votingRoundIdToReveals.get(i);
      if (!commits || commits.length === 0) {
        continue;
      }
      const commitsAndReveals = this.getVoterToLastCommitAndRevealMapsForVotingRound(i, commits, reveals);
      const revealOffenders = this.getRevealOffenders(commitsAndReveals.commits, commitsAndReveals.reveals);
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
  private getVoterToLastCommitAndRevealMapsForVotingRound(
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
    };
  }

  /**
   * Creates a mapper form voter address to last commit data message for FTSO protocol and matching voting round id
   * from the given submission data array.
   * ASSUMPTION 1: submissions in submissionDataArray are all for the same votingRoundId
   * ASSUMPTION 2: submissions in submissionDataArray are all commit transactions that happen in this votingRoundId
   * ASSUMPTION 3: submissionDataArray is ordered in the blockchain chronological order
   * NOTICE: actually assumes, but does not check
   * @param submissionDataArray
   * @returns
   */
  private getVoterToLastCommitMap(submissionDataArray: SubmissionData[]): Map<Address, ICommitData> {
    const voterToLastCommit = new Map<Address, ICommitData>();
    for (const submission of submissionDataArray) {
      for (const message of submission.messages) {
        if (
          message.protocolId === FTSO2_PROTOCOL_ID &&
          message.votingRoundId === submission.votingEpochIdFromTimestamp
        ) {
          const commit = CommitData.decode(message.payload);
          voterToLastCommit.set(submission.submitAddress, commit);
        }
      }
    }
    return voterToLastCommit;
  }

  /**
   * Create a mapper form voter address to last reveal data message for FTSO protocol and matching voting round id
   * from the given submission data array.
   * ASSUMPTION 1: submissions in submissionDataArray are all for the same votingRoundId
   * ASSUMPTION 2: submissions in submissionDataArray are all reveal transactions that happen in this votingRoundId
   * ASSUMPTION 3: submissions in submissionDataArray all reveal transactions that happen in the correct time window (before reveal deadline)
   * ASSUMPTION 4: submissionDataArray is ordered in the blockchain chronological order
   * NOTICE: actually assumes, but does not check
   * @param submissionDataArray
   * @param feedOrder
   * @returns
   */
  private getVoterToLastRevealMap(
    submissionDataArray: SubmissionData[],
    feedOrder?: Feed[]
  ): Map<Address, IRevealData> {
    const voterToLastReveal = new Map<Address, IRevealData>();
    for (const submission of submissionDataArray) {
      for (const message of submission.messages) {
        if (
          message.protocolId === FTSO2_PROTOCOL_ID &&
          message.votingRoundId + 1 === submission.votingEpochIdFromTimestamp
        ) {
          const reveal = RevealData.decode(message.payload, feedOrder);
          voterToLastReveal.set(submission.submitAddress, reveal);
        }
      }
    }
    return voterToLastReveal;
  }

  /**
   * Sorts submission data array in the blockchain chronological order.
   * @param submissionDataArray
   */
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
  /**
   * Creates a mapper from voting round id to submission data array for the given submission data array.
   * OPTION 1: if type is 'commit', then the mapper maps voting round id to commit submissions
   * OPTION 2: if type is 'reveal', then the mapper maps voting round id to reveal submissions
   * @param submissionEpochArray
   * @param type: "commit" | "reveal"
   * @returns
   */
  private remapSubmissionDataArrayToVotingRounds(submissionEpochArray: SubmissionData[], type: "commit" | "reveal") {
    const offset = type === "commit" ? 0 : 1;
    const votingRoundIdWithOffsetToSubmission = new Map<number, SubmissionData[]>();
    for (const submission of submissionEpochArray) {
      const votingRoundId = submission.votingEpochIdFromTimestamp - offset;
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

  /**
   * Filters out too late reveals.
   * @param reveals
   * @returns
   */
  private filterRevealsByDeadlineTime(reveals: SubmissionData[]) {
    return reveals.filter(reveal => reveal.relativeTimestamp < EPOCH_SETTINGS.revealDeadlineSeconds);
  }
}
