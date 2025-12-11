/* eslint-disable */
import { unPrefix0x } from "../../../ftso-core/src/utils/encoding";
import { RawEventConstructible } from "./RawEventConstructible";
import { decodeEvent } from "../abi/AbiCache";
import { CONTRACTS } from "../constants";

/**
 * Inflation rewards offer as obtained from an event of
 * InflationRewardsOffered from the FtsoRewardOfferManager smart contract
 */
export class InflationRewardsOffered extends RawEventConstructible {
  static eventName = "InflationRewardsOffered";

  constructor(data: any) {
    super();
    let unPrefixed = unPrefix0x(data.feedIds);
    if (unPrefixed.length % 42 !== 0) {
      throw new Error("Feed names must be multiple of 21 bytes");
    }
    this.feedIds = unPrefixed.match(/.{1,42}/g).map((x) => "0x" + x);

    unPrefixed = unPrefix0x(data.secondaryBandWidthPPMs);
    if (unPrefixed.length % 6 !== 0) {
      throw new Error("Secondary band width PPMs must be multiple of 3 bytes");
    }
    this.secondaryBandWidthPPMs = unPrefixed.match(/.{1,6}/g).map((v) => parseInt(v, 16));
    if (this.feedIds.length !== this.secondaryBandWidthPPMs.length) {
      throw new Error("Feed names and secondary band width PPMs must have same length");
    }
    this.rewardEpochId = Number(data.rewardEpochId);

    const unprefixedDecimals = unPrefix0x(data.decimals);
    if (unprefixedDecimals.length % 2 !== 0) {
      throw new Error("Decimals must be multiple of 1 byte");
    }

    this.decimals = unprefixedDecimals.match(/.{1,2}/g).map((v) => parseInt(v, 16));
    if (this.decimals.length !== this.feedIds.length) {
      throw new Error("Feed names and decimals must have same length");
    }

    this.amount = BigInt(data.amount);
    this.mode = Number(data.mode);
    this.primaryBandRewardSharePPM = Number(data.primaryBandRewardSharePPM);
    this.minRewardedTurnoutBIPS = Number(data.minRewardedTurnoutBIPS);
  }

  static fromRawEvent(event: any): InflationRewardsOffered {
    return decodeEvent<InflationRewardsOffered>(
      CONTRACTS.FtsoRewardOffersManager.name,
      InflationRewardsOffered.eventName,
      event,
      (data: any) => new InflationRewardsOffered(data)
    );
  }

  // Sequential index of the offer for the reward epoch as they appear on the blockchain
  // Note that the first index equals the number of community reward offers, since
  // the community reward offers are enumerate first and then the inflation reward offers follow.
  offerIndex?: number;
  // reward epoch id
  rewardEpochId: number;
  // feed id - i.e. type + base/quote symbols - multiple of 21 (one feedId is bytes21)
  feedIds: string[];
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
