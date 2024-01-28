import { CONTRACTS } from "../configs/networks";
import { decodeEvent } from "../utils/EncodingUtils";
import { Address } from "../voting-types";
import { RawEventConstructible } from "./RawEventConstructible";

/**
 * VoterRegistration object obtained from the VotingRegistry smart contract
 * as an event VoterRegistered.
 */
export class VoterRegistered extends RawEventConstructible {
  static eventName = "VoterRegistered";
  constructor(data: any) {
    super();
    this.rewardEpochId = Number(data.rewardEpochId);
    this.voter = data.voter.toLowerCase();
    this.signingPolicyAddress = data.signingPolicyAddress.toLowerCase();
    this.delegationAddress = data.delegationAddress.toLowerCase();
    this.submitAddress = data.submitAddress.toLowerCase();
    this.submitSignaturesAddress = data.submitSignaturesAddress.toLowerCase();
    this.registrationWeight = BigInt(data.registrationWeight);
  }

  static fromRawEvent(event: any): VoterRegistered {
    return decodeEvent<VoterRegistered>(
      CONTRACTS.VoterRegistry.name,
      VoterRegistered.eventName,
      event,
      (data: any) => new VoterRegistered(data)
    );
  }

  voter: Address;
  rewardEpochId: number;
  signingPolicyAddress: Address;
  delegationAddress: Address;
  submitAddress: Address;
  submitSignaturesAddress: Address;
  registrationWeight: bigint;
}
