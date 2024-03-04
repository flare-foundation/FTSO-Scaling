import { BlockAssuranceResult, IndexerClient } from "./IndexerClient";
import { RewardEpoch } from "./RewardEpoch";
import { RewardEpochDuration } from "./utils/RewardEpochDuration";
import { EPOCH_SETTINGS, INITIAL_REWARD_EPOCH_ID, GENESIS_REWARD_EPOCH_START_EVENT } from "./configs/networks";
import { RewardEpochStarted, SigningPolicyInitialized } from "./events";
import { RewardEpochId, VotingEpochId } from "./voting-types";

/**
 * Manages reward epochs
 * 1. Enables access to correct reward epoch for each voting round
 * 2. Keeps a cache of reward epochs
 */
export class RewardEpochManager {
  private readonly rewardEpochsCache = new Map<RewardEpochId, RewardEpoch>();
  constructor(private readonly indexerClient: IndexerClient) { }

  /**
   * Returns a matching reward epoch for the given voting epoch.
   * It tries to get the matching epoch using the cached values. If this
   * is not possible it queries a range of latest SigningPolicyInitialized
   * and determines the matching reward epoch subject to startVotingRound id
   * parameter. If the corresponding RewardEpoch object containing all the relevant
   * reward epoch definitions and mappings (including signing policies) is not in cache,
   * it gets constructed, put in cache and returned.
   * @param votingEpochId
   * @returns
   */
  async getRewardEpochForVotingEpochId(votingEpochId: VotingEpochId): Promise<RewardEpoch | undefined> {
    const currentVotingEpochId = EPOCH_SETTINGS().votingEpochForTime(Date.now());
    if (votingEpochId > currentVotingEpochId) {
      return undefined; // future voting epoch
    }

    const expectedRewardEpochId = EPOCH_SETTINGS().expectedRewardEpochForVotingEpoch(votingEpochId);

    // Try with expected reward epoch
    const rewardEpoch = this.rewardEpochsCache.get(expectedRewardEpochId);
    if (rewardEpoch && rewardEpoch.startVotingRoundId <= votingEpochId) {
      return rewardEpoch;
    }
    const lowestExpectedIndexerHistoryTime = await this.indexerClient.secureLowestTimestamp();
    //Math.floor(Date.now() / 1000) - this.indexerClient.requiredHistoryTimeSec;
    const signingPolicyInitializedEvents = await this.indexerClient.getLatestSigningPolicyInitializedEvents(
      lowestExpectedIndexerHistoryTime
    );
    // With a limited history the number of possible events is small. Therefore linear search is ok.
    let i = signingPolicyInitializedEvents.data!.length - 1;
    while (i >= 0) {
      const signingPolicyInitializedEvent = signingPolicyInitializedEvents.data![i];
      if (signingPolicyInitializedEvent.startVotingRoundId <= votingEpochId) {
        break;
      }
      i--;
    }
    if (i < 0) {
      // no such signing policy in database
      throw new Error(
        `Critical error: Signing policy not found after ${lowestExpectedIndexerHistoryTime} - most likely the indexer has too short history`
      );
    }
    return this.initializeRewardEpoch(signingPolicyInitializedEvents.data[i]);
  }

  /**
   * Initializes reward epoch object (RewardEpoch) from signing policy initialized event.
   * In the process it queries for all signing policy definition protocol events,
   * voter registration related events and reward offers.
   * Before returning, the object is put in cache.
   * @param signingPolicyInitializedEvent
   * @returns
   */
  async initializeRewardEpoch(
    signingPolicyInitializedEvent: SigningPolicyInitialized
  ): Promise<RewardEpoch | undefined> {
    if (!signingPolicyInitializedEvent) {
      throw new Error("Critical error: Signing policy must be provided.");
    }
    const rewardEpochId = signingPolicyInitializedEvent.rewardEpochId;
    let previousRewardEpochStartedEventResponseData: RewardEpochStarted;
    if(rewardEpochId > GENESIS_REWARD_EPOCH_START_EVENT().rewardEpochId + 1) {
      previousRewardEpochStartedEventResponseData = await this.getPreviousRewardEpochStartedEvent(rewardEpochId);
    } else if(rewardEpochId === GENESIS_REWARD_EPOCH_START_EVENT().rewardEpochId + 1) {
      previousRewardEpochStartedEventResponseData = GENESIS_REWARD_EPOCH_START_EVENT();
    } else {
      throw new Error(`Critical error: previous reward epoch for reward epoch ${rewardEpochId} is below genesis reward epoch.`);
    }

    const randomAcquisitionStartedEventResponse = await this.indexerClient.getRandomAcquisitionStarted(rewardEpochId);
    if (
      randomAcquisitionStartedEventResponse.status !== BlockAssuranceResult.OK ||
      !randomAcquisitionStartedEventResponse.data
    ) {
      throw new Error(
        "Critical error: RandomAcquisitionStarted event not found - most likely the indexer has too short history"
      );
    }
    const rewardOffersResponse = await this.indexerClient.getRewardOffers(
      previousRewardEpochStartedEventResponseData.timestamp,
      randomAcquisitionStartedEventResponse.data.timestamp
    );

    if (rewardOffersResponse.status !== BlockAssuranceResult.OK || !rewardOffersResponse.data) {
      throw new Error(
        "Critical error: RewardOffers cannot be constructed - most likely the indexer has too short history"
      );
    }

    const votePowerBlockSelectedEventResponse = await this.indexerClient.getVotePowerBlockSelectedEvent(rewardEpochId);
    if (
      votePowerBlockSelectedEventResponse.status !== BlockAssuranceResult.OK ||
      !votePowerBlockSelectedEventResponse.data
    ) {
      throw new Error(
        "Critical error: VotePowerBlockSelected event not found - most likely the indexer has too short history"
      );
    }

    const fullVoterRegistrationInfoResponse = await this.indexerClient.getFullVoterRegistrationInfoEvents(
      votePowerBlockSelectedEventResponse.data!.timestamp,
      signingPolicyInitializedEvent.timestamp
    );

    if (
      fullVoterRegistrationInfoResponse.status !== BlockAssuranceResult.OK ||
      !fullVoterRegistrationInfoResponse.data
    ) {
      throw new Error(
        "Critical error: FullVoterRegistrationInfo cannot be constructed - most likely the indexer has too short history"
      );
    }

    const rewardEpoch = new RewardEpoch(
      previousRewardEpochStartedEventResponseData,
      randomAcquisitionStartedEventResponse.data,
      rewardOffersResponse.data,
      votePowerBlockSelectedEventResponse.data,
      signingPolicyInitializedEvent,
      fullVoterRegistrationInfoResponse.data
    );

    this.rewardEpochsCache.set(rewardEpochId, rewardEpoch);
    return rewardEpoch;
  }

  private async getPreviousRewardEpochStartedEvent(rewardEpochId: number): Promise<RewardEpochStarted> {
    if (rewardEpochId === INITIAL_REWARD_EPOCH_ID + 1) {
      // Reward epoch start event does not exist for initial reward epoch
      return GENESIS_REWARD_EPOCH_START_EVENT();
    } else {
      const previousRewardEpochStartedEventResponse = await this.indexerClient.getStartOfRewardEpochEvent(
        rewardEpochId - 1
      );

      if (
        previousRewardEpochStartedEventResponse.status !== BlockAssuranceResult.OK ||
        !previousRewardEpochStartedEventResponse.data
      ) {
        throw new Error(
          `Critical error: Previous reward epoch ${rewardEpochId - 1
          } RewardEpochStarted event not found - most likely the indexer has too short history`
        );
      }
      return previousRewardEpochStartedEventResponse.data;
    }
  }

  /**
   * By finding the latest SigningPolicyInitialized event for reward epoch id, and a subsequent event
   * for the next reward epoch id, it determines the start and end voting round ids for the given reward epoch id.
   * If the events cannot be found in the database, error is thrown.
   * @param rewardEpochId
   * @returns
   */
  public async getRewardEpochDurationRange(
    rewardEpochId: number,
    useExpectedEndIfNoSigningPolicyAfter = false
  ): Promise<RewardEpochDuration> {
    const lowestExpectedIndexerHistoryTime = await this.indexerClient.secureLowestTimestamp();
    //Math.floor(Date.now() / 1000) - this.indexerClient.requiredHistoryTimeSec;
    const signingPolicyInitializedEventsResponse = await this.indexerClient.getLatestSigningPolicyInitializedEvents(
      lowestExpectedIndexerHistoryTime
    );
    if (signingPolicyInitializedEventsResponse.status !== BlockAssuranceResult.OK) {
      throw new Error(
        "Critical error: SigningPolicyInitialized events not found - most likely the indexer has too short history"
      );
    }
    for (let i = 0; i < signingPolicyInitializedEventsResponse.data!.length; i++) {
      const signingPolicyInitializedEvent = signingPolicyInitializedEventsResponse.data![i];
      if (signingPolicyInitializedEvent.rewardEpochId === rewardEpochId) {
        if (i === signingPolicyInitializedEventsResponse.data!.length - 1) {
          if (!useExpectedEndIfNoSigningPolicyAfter) {
            throw new Error(
              "Critical error: SigningPolicyInitialized events not found - most likely the indexer has too short history"
            );
          } else {
            const expectedEndVotingRoundId =
              EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId + 1) - 1;
            return {
              rewardEpochId,
              startVotingRoundId: signingPolicyInitializedEvent.startVotingRoundId,
              endVotingRoundId: expectedEndVotingRoundId,
              expectedEndUsed: true,
            };
          }
        }
        const nextSigningPolicyInitializedEvent = signingPolicyInitializedEventsResponse.data![i + 1];
        return {
          rewardEpochId,
          startVotingRoundId: signingPolicyInitializedEvent.startVotingRoundId,
          endVotingRoundId: nextSigningPolicyInitializedEvent.startVotingRoundId - 1,
          expectedEndUsed: false,
        };
      }
    }
  }
}
