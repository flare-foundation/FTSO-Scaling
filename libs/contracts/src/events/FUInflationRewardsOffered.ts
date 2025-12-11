/* eslint-disable */
import { RawEventConstructible } from "./RawEventConstructible";
import { decodeEvent } from "../abi/AbiCache";
import { CONTRACTS } from "../constants";

export interface FastUpdateFeedConfiguration {
  // feed id (21 byte hex string)
  feedId: string;
  // reward band value (interpreted off-chain) in relation to the median
  rewardBandValue: number;
  // inflation share
  inflationShare: number;
}

/**
 * Represents an event emitted on offering inflation rewards on FastUpdateIncentiveManager smart contract.
 */
export class FUInflationRewardsOffered extends RawEventConstructible {
  static eventName = "InflationRewardsOffered";
  constructor(data: any) {
    super();
    this.rewardEpochId = Number(data.rewardEpochId);
    this.feedConfigurations = data.feedConfigurations.map((v: any) => {
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

  // amount
  amount: bigint;
}
