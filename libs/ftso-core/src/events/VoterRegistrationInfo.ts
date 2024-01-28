import { CONTRACTS } from "../configs/networks";
import { decodeEvent } from "../utils/EncodingUtils";
import { Address, Bytes20 } from "../voting-types";
import { RawEventConstructible } from "./RawEventConstructible";

/**
 * VoterRegistrationInfo object obtained from the FlareSystemCalculator smart contract
 * as an event VoterRegistrationInfo.
 */
export class VoterRegistrationInfo extends RawEventConstructible {
  static eventName = "VoterRegistrationInfo";
  constructor(data: any) {
    super();
    this.voter = data.voter.toLowerCase();
    this.rewardEpochId = Number(data.rewardEpochId);
    this.wNatWeight = BigInt(data.wNatWeight);
    this.wNatCappedWeight = BigInt(data.wNatCappedWeight);
    this.nodeIds = data.nodeIds.map((v: Bytes20) => v.toLowerCase());
    this.nodeWeights = data.nodeWeights.map((v: number | string) => BigInt(v));
    this.delegationFeeBIPS = Number(data.delegationFeeBIPS);
  }

  static fromRawEvent(event: any): VoterRegistrationInfo {
    return decodeEvent<VoterRegistrationInfo>(
      CONTRACTS.FlareSystemCalculator.name,
      VoterRegistrationInfo.eventName,
      event,
      (data: any) => new VoterRegistrationInfo(data)
    );
  }

  voter: Address;
  rewardEpochId: number;
  wNatWeight: bigint;
  wNatCappedWeight: bigint;
  nodeIds: Bytes20[];
  nodeWeights: bigint[];
  delegationFeeBIPS: number;
}
