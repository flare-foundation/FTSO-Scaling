import { IndexerClient } from "./IndexerClient";
import { RewardEpoch } from "./RewardEpoch";
import { EPOCH_SETTINGS } from "./configs/networks";
import { RewardEpochId } from "./voting-types";

export class RewardEpochManager {
   indexerClient: IndexerClient;
   rewardEpochsCache: Map<RewardEpochId, RewardEpoch>;
   constructor(indexerClient: IndexerClient) { 
      this.indexerClient = indexerClient;
      this.rewardEpochsCache = new Map<RewardEpochId, RewardEpoch>();
   }

   async getRewardEpoch(votingRoundId: RewardEpochId): RewardEpoch | undefined {

      const currentVotingEpochId = EPOCH_SETTINGS.votingEpochForTime(Date.now());
      if(votingRoundId > currentVotingEpochId) {
         return undefined; // future voting epoch
      }

      const expectedRewardEpochId = EPOCH_SETTINGS.expectedRewardEpochForVotingEpoch(votingRoundId);      

      let rewardEpoch = this.rewardEpochsCache.get(expectedRewardEpochId);
      if(!rewardEpoch) {
         rewardEpoch = await this.tryGetRewardEpoch(expectedRewardEpochId);
      }

      // podleda startVotingRoundId in če je manjši od tega, potem poišče še prejšnjega, in ga skonstruira in vrene.

      if(this.minRewardEpochId < 0) {
         return undefined;  // no reward epochs yet
      }
      let minStartVotingEpochId = this.rewardEpochsCache.get(this.minRewardEpochId)!.startVotingRoundId;
      if(votingRoundId < minStartVotingEpochId) {
         return undefined; // Maybe this should be an exception, because this should not happen
      }
      let maxStartVotingEpochId = this.rewardEpochsCache.get(this.maxRewardEpochId)!.startVotingRoundId;
      if(votingRoundId > maxStartVotingEpochId) {
         const expectedRewardEpochId = EPOCH_SETTINGS.expectedRewardEpochForVotingEpoch(votingRoundId);
         if(expectedRewardEpochId == this.maxRewardEpochId) {
            return this.rewardEpochsCache.get(this.maxRewardEpochId);
         }
         if(expectedRewardEpochId == this.maxRewardEpochId + 1) {
            return this.rewardEpochsCache.get(this.maxRewardEpochId);
         }
         return undefined;
      }
      let rewardEpochId = this.minRewardEpochId;
      while (votingRoundId < this.rewardEpochsCache.get(rewardEpochId)!.startVotingRoundId) rewardEpochId++;
      return this.rewardEpochsCache.get(rewardEpochId);
   }


   async tryGetRewardEpoch(rewardEpochId: RewardEpochId): Promise<RewardEpoch | undefined> {
      // Proba poiskat SigningPolciyInitialized event v predpisanem intervalu
      // Če ga najde potem naredi še vse ostale querye in naredi RewardEpoch ter ga vren
      // Če ne vrne undefined.
   }
}

