import { Address } from "../../../ftso-core/src/voting-types";
import { RawEventConstructible } from "./RawEventConstructible";
import {decodeEvent} from "../abi/AbiCache";
import {CONTRACTS} from "../constants";

/**
 * RewardOffer object obtained from the FtsoRewardOfferManager smart contract
 * as an event RewardsOffered.
 */
export class RewardsOffered extends RawEventConstructible {
  static eventName = "RewardsOffered";
  constructor(data: any) {
    super();
    this.rewardEpochId = Number(data.rewardEpochId);
    this.feedId = data.feedId.startsWith("0x") ? data.feedId : "0x" + data.feedId;
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
  // Sequential index of the offer for the reward epoch as they appear on the blockchain
  offerIndex?: number;
  // reward epoch id
  rewardEpochId: number;
  // feed id - i.e. type + feed name
  feedId: string;
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
