import { Sign } from "crypto";
import { IndexerClient } from "./IndexerClient";
import { RewardEpoch } from "./RewardEpoch";
import { EPOCH_SETTINGS } from "./configs/networks";
import { RewardEpochId } from "./voting-types";
import { SigningPolicyInitialized } from "./events";

export class RewardEpochManager {
   indexerClient: IndexerClient;
   rewardEpochsCache: Map<RewardEpochId, RewardEpoch>;
   constructor(indexerClient: IndexerClient) { 
      this.indexerClient = indexerClient;
      this.rewardEpochsCache = new Map<RewardEpochId, RewardEpoch>();
   }

   async getRewardEpoch(votingRoundId: RewardEpochId): Promise<RewardEpoch | undefined> {
      const currentVotingEpochId = EPOCH_SETTINGS.votingEpochForTime(Date.now());
      if(votingRoundId > currentVotingEpochId) {
         return undefined; // future voting epoch
      }

      // TODO: throw exception on too old voting epoch

      const expectedRewardEpochId = EPOCH_SETTINGS.expectedRewardEpochForVotingEpoch(votingRoundId);      

      // Try with expected reward epoch
      let rewardEpoch = this.rewardEpochsCache.get(expectedRewardEpochId);
      if(rewardEpoch) {
         if(rewardEpoch.startVotingRoundId <= votingRoundId) {
            return rewardEpoch;
         }
         // skip to previous reward epoch check 
      } else { // No expected reward epoch in cache
         const expectedSigningPolicy = await this.indexerClient.getSigningPolicyInitializedEvent(expectedRewardEpochId);
         if(!expectedSigningPolicy) {
            return undefined; // no signing policy yet
         }
         if(expectedSigningPolicy.startVotingRoundId <= votingRoundId) {
            return this.initializeRewardEpoch(expectedSigningPolicy);
         }
      }
      // The expected reward epoch is not the right one, so we need to find the previous one
      const previousRewardEpoch = this.rewardEpochsCache.get(expectedRewardEpochId - 1);
      if(previousRewardEpoch) {
         // sanity check
         if(previousRewardEpoch.startVotingRoundId > votingRoundId) {
            throw new Error("Critical error: previous reward epoch starts later than the expected time of the expected reward epoch. This should never happen.");
         }
         return previousRewardEpoch;
      } else {
         const previousSigningPolicy = await this.indexerClient.getSigningPolicyInitializedEvent(expectedRewardEpochId - 1);
         if(!previousSigningPolicy) {
            throw new Error("Critical error: Previous signing policy not found - most likely the indexer is not synced");
         }
         // sanity check
         if(previousSigningPolicy.startVotingRoundId > votingRoundId) {
            throw new Error("Critical error: Signing policy starts later than the expected time of the expected reward epoch. This should never happen.");
         }
         return this.initializeRewardEpoch(previousSigningPolicy);
      }
   }

   async initializeRewardEpoch(signingPolicyInitializedEvent: SigningPolicyInitialized): Promise<RewardEpoch | undefined> {
      if(!signingPolicyInitializedEvent) {
         throw new Error("Critical error: Signing policy must be provided.");
      }
      const rewardEpochId = signingPolicyInitializedEvent.rewardEpochId;
      const previousRewardEpochStartedEvent = await this.indexerClient.getStartOfRewardEpochEvent(rewardEpochId - 1);
      if(!previousRewardEpochStartedEvent) {
         throw new Error("Critical error: Previous reward epoch RewardEpochStarted event not found - most likely the indexer has too short history");
      }
      const randomAcquisitionStartedEvent = await this.indexerClient.getRandomAcquisitionStarted(rewardEpochId);
      if(!randomAcquisitionStartedEvent) {
         throw new Error("Critical error: AcquisitionStarted event not found - most likely the indexer has too short history");
      }
      const rewardOffers = await this.indexerClient.getRewardOffers(previousRewardEpochStartedEvent.timestamp, randomAcquisitionStartedEvent.timestamp);

      const votePowerBlockSelectedEvent = await this.indexerClient.getVotePowerBlockSelectedEvent(rewardEpochId);
      if(!votePowerBlockSelectedEvent) {
         throw new Error("Critical error: VotePowerBlockSelected event not found - most likely the indexer has too short history");
      }

      const fullVoterRegistrationInfo = await this.indexerClient.getFullVoterRegistrationInfoEvents(votePowerBlockSelectedEvent.timestamp, signingPolicyInitializedEvent.timestamp);

      const rewardEpoch = new RewardEpoch(
         previousRewardEpochStartedEvent,
         randomAcquisitionStartedEvent,
         rewardOffers,
         votePowerBlockSelectedEvent,
         signingPolicyInitializedEvent,
         fullVoterRegistrationInfo
      );

      this.rewardEpochsCache.set(rewardEpochId, rewardEpoch);
      return rewardEpoch;
   }

}

