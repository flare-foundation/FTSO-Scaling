import { CONTRACTS } from "../configs/networks";
import { decodeEvent, unPrefix0x } from "../utils/EncodingUtils";
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
    this.feedName = data.feedName.startsWith("0x") ? data.feedName : "0x" + data.feedName;
    this.decimals = Number(data.decimals);
    this.amount = BigInt(data.amount);
    this.minRewardedTurnoutBIPS = Number(data.minRewardedTurnoutBIPS);
    this.primaryBandRewardSharePPM = Number(data.primaryBandRewardSharePPM);
    this.secondaryBandWidthPPM = Number(data.secondaryBandWidthPPM);
    this.claimBackAddress = data.claimBackAddress.toLowerCase();
  }

  static fromRawEvent(event: any): RewardsOffered {
    return decodeEvent<RewardsOffered>(
      CONTRACTS.FtsoRewardOffersManager.name,
      RewardsOffered.eventName,
      event,
      (data: any) => new RewardsOffered(data)
    );
  }

  // reward epoch id
  rewardEpochId: number;
  // feed name - i.e. base/quote symbol
  feedName: string;
  // number of decimals (negative exponent)
  decimals: number;
  // amount (in wei) of reward in native coin
  amount: bigint;
  // minimal reward eligibility turnout threshold in BIPS (basis points)
  minRewardedTurnoutBIPS: number;
  // primary band reward share in PPM (parts per million)
  primaryBandRewardSharePPM: number;
  // secondary band width in PPM (parts per million) in relation to the median
  secondaryBandWidthPPM: number;
  // address that can claim undistributed part of the reward (or burn address)
  claimBackAddress: Address;
}
