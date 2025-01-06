import { EPOCH_SETTINGS, FDC_PROTOCOL_ID } from "../../../../ftso-core/src/constants";
import { IPartialRewardOfferForRound } from "../../utils/PartialRewardOffer";
import { ClaimType, IPartialRewardClaim } from "../../utils/RewardClaim";
import { SDataForRewardCalculation } from "../../utils/stat-info/reward-calculation-data";
import { RewardEpochInfo } from "../../utils/stat-info/reward-epoch-info";
import { Address } from "../../../../ftso-core/src/voting-types";
import { RewardTypePrefix } from "../RewardTypePrefix";
import { SigningRewardClaimType } from "../reward-signing";
import { generateSigningWeightBasedClaimsForVoter } from "../reward-signing-split";
import { isSignatureBeforeTimestamp, isSignatureInGracePeriod } from "../reward-utils";
import {FINALIZATION_BIPS, TOTAL_BIPS} from "../../constants";
import {FDCEligibleSigner} from "../../data-calculation-interfaces";

/**
 * A split of partial reward offer into three parts:
 */
export interface SplitFDCRewardOffer {
   readonly signingRewardOffer: IPartialRewardOfferForRound;
   readonly finalizationRewardOffer: IPartialRewardOfferForRound;
}


/**
 * Splits a FDC partial reward offer into two parts: signing and finalization.
 * These split offers are used as inputs into reward calculation for specific types
 * of rewards.
 */
export function splitFDCRewardOfferByTypes(offer: IPartialRewardOfferForRound): SplitFDCRewardOffer {
   const forFinalization = (offer.amount * FINALIZATION_BIPS()) / TOTAL_BIPS;
   const forSigning = offer.amount - forFinalization;

   const result: SplitFDCRewardOffer = {
      signingRewardOffer: {
         ...offer,
         amount: forSigning,
      },
      finalizationRewardOffer: {
         ...offer,
         amount: forFinalization,
      },
   };
   return result;
}


/**
 * Given an offer and data for reward calculation it calculates signing rewards for the offer.
 * The reward is distributed to signers that deposited signatures in the grace period or before the timestamp of the first successful finalization.
 * If a successful finalization for the votingRoundId does not happen before the end of the voting epoch
 * votingRoundId + 1 + ADDITIONAL_REWARDED_FINALIZATION_WINDOWS, then the data about the finalization does not enter this function.
 * In this case rewards can be still paid out if there is (are) a signed hash which has more than certain percentage of
 * the total weight of the voting weight deposits.
 * TODO: think through whether to reward only in grace period or up to the end of the voting epoch id of votingRoundId + 1.
 */
export function calculateSigningRewardsForFDC(
   offer: IPartialRewardOfferForRound,
   data: SDataForRewardCalculation,
   rewardEpochInfo: RewardEpochInfo
): IPartialRewardClaim[] {
   const votingRoundId = data.dataForCalculations.votingRoundId;
   // if no successful finalization, nothing to decide - burn all
   if (!data.fdcData?.firstSuccessfulFinalization) {
      // burn all
      const backClaim: IPartialRewardClaim = {
         votingRoundId,
         beneficiary: offer.claimBackAddress.toLowerCase(),
         amount: offer.amount,
         claimType: ClaimType.DIRECT,
         offerIndex: offer.offerIndex,
         feedId: offer.feedId,
         protocolTag: "" + FDC_PROTOCOL_ID,
         rewardTypeTag: RewardTypePrefix.FDC_SIGNING,
         rewardDetailTag: SigningRewardClaimType.NO_TIMELY_FINALIZATION,
      };
      return [backClaim];
   }

   if (data.fdcData.consensusBitVote === undefined || data.fdcData.consensusBitVote === 0n) {
      // burn all
      const backClaim: IPartialRewardClaim = {
         votingRoundId,
         beneficiary: offer.claimBackAddress.toLowerCase(),
         amount: offer.amount,
         claimType: ClaimType.DIRECT,
         offerIndex: offer.offerIndex,
         feedId: offer.feedId,
         protocolTag: "" + FDC_PROTOCOL_ID,
         rewardTypeTag: RewardTypePrefix.FDC_SIGNING,
         rewardDetailTag: SigningRewardClaimType.EMPTY_BITVOTE,
      };
      return [backClaim];
   }

   const orderedSubmitSignatureAddresses = data.dataForCalculations.orderedVotersSubmitSignatureAddresses;
   const totalWeight = rewardEpochInfo.signingPolicy.weights.reduce((acc, weight) => acc + weight, 0);
   const signingAddressToVoter = new Map<Address, FDCEligibleSigner>();

   const deadlineTimestamp = Math.min(
      data.fdcData.firstSuccessfulFinalization.timestamp,
      EPOCH_SETTINGS().votingEpochEndSec(votingRoundId + 1)
   );

   // signingAddressToVoter will map only onto signers that get the reward
   for (const voter of data.fdcData.eligibleSigners) {
      if (isSignatureInGracePeriod(votingRoundId, voter) ||
         isSignatureBeforeTimestamp(votingRoundId, voter, deadlineTimestamp)) {
         signingAddressToVoter.set(voter.submitSignatureAddress.toLowerCase(), voter);
      }
   }

   const allClaims: IPartialRewardClaim[] = [];
   let undistributedWeight = BigInt(totalWeight);
   let undistributedAmount = offer.amount;
   for (let i = 0; i < orderedSubmitSignatureAddresses.length; i++) {
      const submitSignatureAddress = orderedSubmitSignatureAddresses[i];
      const submitAddress = data.dataForCalculations.orderedVotersSubmitAddresses[i];
      const voterData = signingAddressToVoter.get(submitSignatureAddress)
      if (voterData) {
         let voterAmount = BigInt(voterData.weight) * undistributedAmount / undistributedWeight;
         undistributedAmount -= voterAmount;
         undistributedWeight -= BigInt(voterData.weight);
         const voterWeights = data.dataForCalculations.votersWeightsMap!.get(submitAddress);
         if (!voterData.dominatesConsensusBitVote) {
            // burn 20%
            const burnAmount = 200000n * voterAmount / 1000000n;
            voterAmount -= burnAmount;
            if (burnAmount > 0n) {
               const burnClaim: IPartialRewardClaim = {
                  votingRoundId,
                  beneficiary: offer.claimBackAddress.toLowerCase(),
                  amount: burnAmount,
                  claimType: ClaimType.DIRECT,
                  offerIndex: offer.offerIndex,
                  feedId: offer.feedId,
                  protocolTag: "" + FDC_PROTOCOL_ID,
                  rewardTypeTag: RewardTypePrefix.FDC_SIGNING,
                  rewardDetailTag: SigningRewardClaimType.NON_DOMINATING_BITVOTE,
               };
               allClaims.push(burnClaim);
            }
         }
         allClaims.push(
            ...generateSigningWeightBasedClaimsForVoter(voterAmount, offer, voterWeights, RewardTypePrefix.FDC_SIGNING, FDC_PROTOCOL_ID)
         );
      }
   }

   // claim back
   if (undistributedAmount > 0n) {
      const backClaim: IPartialRewardClaim = {
         votingRoundId,
         beneficiary: offer.claimBackAddress.toLowerCase(),
         amount: undistributedAmount,
         claimType: ClaimType.DIRECT,
         offerIndex: offer.offerIndex,
         feedId: offer.feedId,
         protocolTag: "" + FDC_PROTOCOL_ID,
         rewardTypeTag: RewardTypePrefix.FDC_SIGNING,
         rewardDetailTag: SigningRewardClaimType.CLAIM_BACK_OF_NON_SIGNERS_SHARE,
      };
      allClaims.push(backClaim);
   }
   return allClaims;
}
