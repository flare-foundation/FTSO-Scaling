import { BlockAssuranceResult, IndexerClient } from "./IndexerClient";
import { RewardEpoch } from "./RewardEpoch";
import { EPOCH_SETTINGS } from "./configs/networks";
import { SigningPolicyInitialized } from "./events";
import { RewardEpochId, VotingEpochId } from "./voting-types";

/**
 * Manages reward epochs
 * 1. Enables access to correct reward epoch for each voting round
 * 2. Keeps a cache of reward epochs
 */
export class RewardEpochManager {
   indexerClient: IndexerClient;
   rewardEpochsCache: Map<RewardEpochId, RewardEpoch>;
   constructor(indexerClient: IndexerClient) {
      this.indexerClient = indexerClient;
      this.rewardEpochsCache = new Map<RewardEpochId, RewardEpoch>();
   }

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
   async getRewardEpoch(votingEpochId: VotingEpochId): Promise<RewardEpoch | undefined> {
      const currentVotingEpochId = EPOCH_SETTINGS.votingEpochForTime(Date.now());
      if (votingEpochId > currentVotingEpochId) {
         return undefined; // future voting epoch
      }

      const expectedRewardEpochId = EPOCH_SETTINGS.expectedRewardEpochForVotingEpoch(votingEpochId);

      // Try with expected reward epoch
      let rewardEpoch = this.rewardEpochsCache.get(expectedRewardEpochId);
      if (rewardEpoch && rewardEpoch.startVotingRoundId <= votingEpochId) {
         return rewardEpoch;
      }
      const lowestExpectedIndexerHistoryTime = Math.floor(Date.now() / 1000) - this.indexerClient.requiredHistoryTimeSec;
      const signingPolicyInitializedEvents = await this.indexerClient.getLatestSigningPolicyInitializedEvents(lowestExpectedIndexerHistoryTime);
      let i = signingPolicyInitializedEvents.data!.length - 1;
      while (i >= 0) {
         const signingPolicyInitializedEvent = signingPolicyInitializedEvents.data![i];
         if (signingPolicyInitializedEvent.startVotingRoundId <= votingEpochId) {
            break;
         }
         i--;
      }
      if (i < 0) {
         // no such signing policy in requiredHistoryTimeSec window
         throw new Error(`Critical error: Signing policy not found after ${lowestExpectedIndexerHistoryTime} - most likely the indexer has too short history`);
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
   async initializeRewardEpoch(signingPolicyInitializedEvent: SigningPolicyInitialized): Promise<RewardEpoch | undefined> {
      if (!signingPolicyInitializedEvent) {
         throw new Error("Critical error: Signing policy must be provided.");
      }
      const rewardEpochId = signingPolicyInitializedEvent.rewardEpochId;
      const previousRewardEpochStartedEventResponse = await this.indexerClient.getStartOfRewardEpochEvent(rewardEpochId - 1);
      if (previousRewardEpochStartedEventResponse.status !== BlockAssuranceResult.OK || !previousRewardEpochStartedEventResponse.data) {
         throw new Error("Critical error: Previous reward epoch RewardEpochStarted event not found - most likely the indexer has too short history");
      }
      const randomAcquisitionStartedEventResponse = await this.indexerClient.getRandomAcquisitionStarted(rewardEpochId);
      if (randomAcquisitionStartedEventResponse.status !== BlockAssuranceResult.OK || !randomAcquisitionStartedEventResponse.data) {
         throw new Error("Critical error: AcquisitionStarted event not found - most likely the indexer has too short history");
      }
      const rewardOffersResponse = await this.indexerClient.getRewardOffers(
         previousRewardEpochStartedEventResponse.data.timestamp,
         randomAcquisitionStartedEventResponse.data.timestamp
      );

      if (rewardOffersResponse.status !== BlockAssuranceResult.OK || !rewardOffersResponse.data) {
         throw new Error("Critical error: RewardOffers cannot be constructed - most likely the indexer has too short history");
      }

      const votePowerBlockSelectedEventResponse = await this.indexerClient.getVotePowerBlockSelectedEvent(rewardEpochId);
      if (votePowerBlockSelectedEventResponse.status !== BlockAssuranceResult.OK || !votePowerBlockSelectedEventResponse.data) {
         throw new Error("Critical error: VotePowerBlockSelected event not found - most likely the indexer has too short history");
      }

      const fullVoterRegistrationInfoResponse = await this.indexerClient.getFullVoterRegistrationInfoEvents(
         votePowerBlockSelectedEventResponse.data!.timestamp,
         signingPolicyInitializedEvent.timestamp
      );

      if (fullVoterRegistrationInfoResponse.status !== BlockAssuranceResult.OK || !fullVoterRegistrationInfoResponse.data) {
         throw new Error("Critical error: FullVoterRegistrationInfo cannot be constructed - most likely the indexer has too short history");
      }

      const rewardEpoch = new RewardEpoch(
         previousRewardEpochStartedEventResponse.data,
         randomAcquisitionStartedEventResponse.data,
         rewardOffersResponse.data,
         votePowerBlockSelectedEventResponse.data,
         signingPolicyInitializedEvent,
         fullVoterRegistrationInfoResponse.data
      );

      this.rewardEpochsCache.set(rewardEpochId, rewardEpoch);
      return rewardEpoch;
   }

}

