/* eslint-disable */
import { RawEventConstructible } from "./RawEventConstructible";
import { decodeEvent } from "../abi/AbiCache";
import { CONTRACTS } from "../constants";

export interface FdcConfiguration {
  // attestation type
  attestationType: string;
  // source
  source: string;
  // inflation share for this configuration
  inflationShare: number;
  // minimal reward eligibility threshold in number of request
  minRequestsThreshold: number;
  // mode (additional settings interpreted on the client side off-chain)
  mode: bigint;
}

/**
 * Represents an event emitted on offering inflation rewards on FdcHub smart contract.
 */
export class FDCInflationRewardsOffered extends RawEventConstructible {
  static eventName = "InflationRewardsOffered";
  constructor(data: any) {
    super();
    this.rewardEpochId = Number(data.rewardEpochId);
    this.fdcConfigurations = data.fdcConfigurations.map((v: any) => {
      const config: FdcConfiguration = {
        attestationType: v.attestationType,
        source: v.source,
        inflationShare: Number(v.inflationShare),
        minRequestsThreshold: Number(v.minRequestsThreshold),
        mode: BigInt(v.mode),
      };
      return config;
    });
    this.amount = BigInt(data.amount);
  }

  static fromRawEvent(event: any): FDCInflationRewardsOffered {
    return decodeEvent<FDCInflationRewardsOffered>(
      CONTRACTS.FdcHub.name,
      FDCInflationRewardsOffered.eventName,
      event,
      (data: any) => new FDCInflationRewardsOffered(data)
    );
  }

  // reward epoch id
  rewardEpochId: number;

  // fdc configurations
  fdcConfigurations: FdcConfiguration[];

  // amount (in wei) of reward in native coin
  amount: bigint;
}
