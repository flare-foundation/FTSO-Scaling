/* eslint-disable */
import { Address, Bytes20 } from "../../../ftso-core/src/voting-types";
import { RawEventConstructible } from "./RawEventConstructible";
import { decodeEvent } from "../abi/AbiCache";
import { CONTRACTS } from "../constants";

/**
 * VoterRegistrationInfo object obtained from the FlareSystemsCalculator smart contract
 * as an event VoterRegistrationInfo.
 */
export class VoterRegistrationInfo extends RawEventConstructible {
  static eventName = "VoterRegistrationInfo";
  constructor(data: any) {
    super();
    this.voter = data.voter.toLowerCase();
    this.rewardEpochId = Number(data.rewardEpochId);
    this.delegationAddress = data.delegationAddress.toLowerCase();
    this.delegationFeeBIPS = Number(data.delegationFeeBIPS);
    this.wNatWeight = BigInt(data.wNatWeight);
    this.wNatCappedWeight = BigInt(data.wNatCappedWeight);
    this.nodeIds = data.nodeIds.map((v: Bytes20) => v.toLowerCase());
    this.nodeWeights = data.nodeWeights.map((v: number | string) => BigInt(v));
  }

  static fromRawEvent(event: any): VoterRegistrationInfo {
    return decodeEvent<VoterRegistrationInfo>(
      CONTRACTS.FlareSystemsCalculator.name,
      VoterRegistrationInfo.eventName,
      event,
      (data: any) => new VoterRegistrationInfo(data)
    );
  }

  voter: Address; //identityAddress
  rewardEpochId: number;
  delegationAddress: Address;
  delegationFeeBIPS: number;
  wNatWeight: bigint;
  wNatCappedWeight: bigint;
  nodeIds: Bytes20[];
  nodeWeights: bigint[];
}
