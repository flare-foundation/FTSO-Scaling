import { FullVoterRegistrationInfo, RandomAcquisitionStarted, RewardEpochStarted, RewardOffers, SigningPolicyInitialized, VotePowerBlockSelected } from "./events";
import { ISigningPolicy } from "./utils/SigningPolicy";
import { RewardEpochId, VotingEpochId } from "./voting-types";

export class RewardEpoch {

   signingPolicy: ISigningPolicy;

   constructor(
      previousRewardEpochStartedEvent: RewardEpochStarted,
      randomAcquisitionStartedEvent: RandomAcquisitionStarted,
      rewardOffers: RewardOffers,
      votePowerBlockSelectedEvent: VotePowerBlockSelected,
      signingPolicyInitializedEvent: SigningPolicyInitialized,
      fullVoterRegistrationInfo: FullVoterRegistrationInfo[]
   ) {
      this.signingPolicy = signingPolicyInitializedEvent;

      ///////// Consistency checks /////////
      if (this.signingPolicy.rewardEpochId !== previousRewardEpochStartedEvent.rewardEpochId + 1) {
         throw new Error("Previous Reward Epoch Id is not correct");
      }
      if (this.signingPolicy.rewardEpochId !== randomAcquisitionStartedEvent.rewardEpochId) {
         throw new Error("Random Acquisition Reward Epoch Id is not correct");
      }
      for (let rewardOffer of rewardOffers.rewardOffers) {
         if (this.signingPolicy.rewardEpochId !== rewardOffer.rewardEpochId) {
            throw new Error("Reward Offer Reward Epoch Id is not correct");
         }
      }
      for (let inflationOffer of rewardOffers.inflationOffers) {
         if (this.signingPolicy.rewardEpochId !== inflationOffer.rewardEpochId) {
            throw new Error("Inflation Offer Reward Epoch Id is not correct");
         }
      }
      if (this.signingPolicy.rewardEpochId !== votePowerBlockSelectedEvent.rewardEpochId) {
         throw new Error("Vote Power Block Selected Reward Epoch Id is not correct");
      }
      for (let voterRegistration of fullVoterRegistrationInfo) {
         if (this.signingPolicy.rewardEpochId !== voterRegistration.voterRegistered.rewardEpochId) {
            throw new Error("Voter Registration Reward Epoch Id is not correct");
         }
         if (this.signingPolicy.rewardEpochId !== voterRegistration.voterRegistrationInfo.rewardEpochId) {
            throw new Error("Voter Registration Info Reward Epoch Id is not correct");
         }
      }

      ///////// Data initialization /////////


   }

   get rewardEpochId(): RewardEpochId {
      return this.signingPolicy.rewardEpochId;
   }

   get startVotingRoundId(): VotingEpochId {
      return this.signingPolicy.startVotingRoundId;
   }

}