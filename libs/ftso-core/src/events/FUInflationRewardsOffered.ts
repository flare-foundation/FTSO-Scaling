import { CONTRACTS } from "../configs/networks";
import { decodeEvent } from "../utils/EncodingUtils";
import { RawEventConstructible } from "./RawEventConstructible";

export interface FastUpdateFeedConfiguration {
  // feed id (21 byte hex string)
  feedId: string;
  // reward band value (interpreted off-chain) in relation to the median
  rewardBandValue: number;
  // inflation share
  inflationShare: number;
}

export class FUInflationRewardsOffered extends RawEventConstructible {
  static eventName = "InflationRewardsOffered";
  constructor(data: any) {
    super();
    this.rewardEpochId = Number(data.rewardEpochId);
    this.feedConfigurations = data.feedValues.map((v: any) => {
      const config: FastUpdateFeedConfiguration = {
        feedId: v.feedId,
        rewardBandValue: Number(v.rewardBandValue),
        inflationShare: Number(v.inflationShare),
      };
      return config;
    });
    this.amount = BigInt(data.amount);
  }

  static fromRawEvent(event: any): FUInflationRewardsOffered {
    return decodeEvent<FUInflationRewardsOffered>(
      CONTRACTS.FastUpdateIncentiveManager.name,
      FUInflationRewardsOffered.eventName,
      event,
      (data: any) => new FUInflationRewardsOffered(data)
    );
  }

  // reward epoch id
  rewardEpochId: number;

  // Feed values in the order of feedIds
  feedConfigurations: FastUpdateFeedConfiguration[];

  // feed decimals
  amount: bigint;
}
