import { InflationRewardsOffered, RewardsOffered } from "../../../contracts/src/events";

export interface RewardOffers {
  inflationOffers: InflationRewardsOffered[];
  rewardOffers: RewardsOffered[];
}
