import { CONTRACTS } from "../configs/networks";
import { decodeEvent } from "../utils/EncodingUtils";
import { Bytes32 } from "../utils/sol-types";
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
    this.submitAddress = data.submitAddress.toLowerCase();
    this.submitSignaturesAddress = data.submitSignaturesAddress.toLowerCase();
    this.publicKeyPart1 = data.publicKeyPart1;
    this.publicKeyPart2 = data.publicKeyPart2;
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
  submitAddress: Address;
  submitSignaturesAddress: Address;
  publicKeyPart1: Bytes32;
  publicKeyPart2: Bytes32;
  registrationWeight: bigint;
}
