import { CONTRACTS } from "../configs/networks";
import { decodeEvent } from "../utils/EncodingUtils";
import { Address } from "../voting-types";
import { RawEventConstructible } from "./RawEventConstructible";

/**
 * RewardOffer object obtained from the FtsoRewardOfferManager smart contract
 * as an event RewardsOffered.
 */
export class RewardsOffered extends RawEventConstructible {
  static eventName = "RewardsOffered";
  constructor(data: any) {
    super();
    this.rewardEpochId = Number(data.rewardEpochId);
    this.feedName = data.feedName;
    this.decimals = Number(data.decimals);
    this.amount = BigInt(data.amount);
    this.primaryBandRewardSharePPM = Number(data.primaryBandRewardSharePPM);
    this.secondaryBandWidthPPM = Number(data.secondaryBandWidthPPM);
    this.rewardEligibilityPPM = Number(data.rewardEligibilityPPM);
    this.leadProviders = data.leadProviders.map((v: string) => v.toLowerCase());
    this.claimBackAddress = data.claimBackAddress.toLowerCase();
  }

  static fromRawEvent(event: any): RewardsOffered {
    return decodeEvent<RewardsOffered>(CONTRACTS.FtsoRewardOffersManager.name, RewardsOffered.eventName, event, (data: any) => new RewardsOffered(data))
  }

  // reward epoch id
  rewardEpochId: number;
  // feed name - i.e. base/quote symbol
  feedName: string;
  // number of decimals (negative exponent)
  decimals: number;
  // amount (in wei) of reward in native coin
  amount: bigint;
  // primary band reward share in PPM (parts per million)
  primaryBandRewardSharePPM: number;
  // secondary band width in PPM (parts per million) in relation to the median
  secondaryBandWidthPPM: number;
  // reward eligibility in PPM (parts per million) in relation to the median of the lead providers
  rewardEligibilityPPM: number;
  // list of lead providers
  leadProviders: Address[];
  // address that can claim undistributed part of the reward (or burn address)
  claimBackAddress: Address;
}
