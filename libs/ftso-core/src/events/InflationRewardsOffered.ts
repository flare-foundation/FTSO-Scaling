import { CONTRACTS } from "../configs/networks";
import { decodeEvent, unPrefix0x } from "../utils/EncodingUtils";
import { RawEventConstructible } from "./RawEventConstructible";


/**
 * Inflation rewards offer as obtained from an event of 
 * InflationRewardsOffered from the FtsoRewardOfferManager smart contract
 */
export class InflationRewardsOffered extends RawEventConstructible {
  static eventName = "InflationRewardsOffered";

  constructor(data: any) {
    super()
    let unPrefixed = unPrefix0x(data.feedNames);
    if (unPrefixed.length % 16 !== 0) {
      throw new Error("Feed names must be multiple of 8 bytes");
    }
    this.feedNames = unPrefixed.match(/.{1,16}/g);

    unPrefixed = unPrefix0x(data.secondaryBandWidthPPMs);
    if (unPrefixed.length % 6 !== 0) {
      throw new Error("Secondary band width PPMs must be multiple of 3 bytes");
    }
    this.secondaryBandWidthPPMs = unPrefixed.match(/.{1,6}/g).map(v => parseInt(v, 16));
    if (this.feedNames.length !== this.secondaryBandWidthPPMs.length) {
      throw new Error("Feed names and secondary band width PPMs must have same length");
    }
    this.rewardEpochId = Number(data.rewardEpochId);

    const unprefixedDecimals = unPrefix0x(data.decimals)
    if (unprefixedDecimals.length % 2 !== 0) {
      throw new Error("Decimals must be multiple of 1 byte");
    }

    this.decimals = unprefixedDecimals.match(/.{1,2}/g).map(v => parseInt(v, 16));
    if (this.decimals.length !== this.feedNames.length) {
      throw new Error("Feed names and decimals must have same length");
    }

    this.amount = BigInt(data.amount);
    this.mode = Number(data.mode);
    this.primaryBandRewardSharePPM = Number(data.primaryBandRewardSharePPM);
    this.minRewardedTurnoutBIPS = Number(data.minRewardedTurnoutBIPS);
  }

  static fromRawEvent(event: any): InflationRewardsOffered {
    return decodeEvent<InflationRewardsOffered>(CONTRACTS.FtsoRewardOffersManager.name, InflationRewardsOffered.eventName, event, (data: any) => new InflationRewardsOffered(data))
  }

  // reward epoch id
  rewardEpochId: number;
  // feed names - i.e. base/quote symbols - multiple of 8 (one feedName is bytes8)
  feedNames: string[];
  // number of decimals (negative exponent)
  decimals: number[];
  // amount (in wei) of reward in native coin
  amount: bigint;
  // minimal reward eligibility turnout threshold in BIPS (basis points)
  minRewardedTurnoutBIPS: number;
  // primary band reward share in PPM (parts per million)
  primaryBandRewardSharePPM: number;
  // secondary band width in PPM (parts per million) in relation to the median - multiple of 3 (uint24)
  secondaryBandWidthPPMs: number[];
  // rewards split mode (0 means equally, 1 means random,...)
  mode: number;

}
