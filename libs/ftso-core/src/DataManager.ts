import { BlockAssuranceResult, GenericSubmissionData, IndexerClient, SubmissionData } from "./IndexerClient";
import { RewardEpoch } from "./RewardEpoch";
import { RewardEpochManager } from "./RewardEpochManager";
import { ContractMethodNames } from "../../contracts/src/definitions";
import { EPOCH_SETTINGS, FTSO2_PROTOCOL_ID, GENESIS_REWARD_EPOCH_START_EVENT } from "./constants";
import { DataForCalculations, DataForCalculationsPartial } from "./data/DataForCalculations";
import { CommitData, ICommitData } from "./data/CommitData";
import { ILogger } from "./utils/ILogger";
import { IRevealData, RevealData } from "./data/RevealData";
import { errorString } from "./utils/error";
import { Address, Feed } from "./voting-types";

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
