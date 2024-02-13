import { CONTRACTS } from "../configs/networks";
import { decodeEvent } from "../utils/EncodingUtils";
import { Address } from "../voting-types";
import { RawEventConstructible } from "./RawEventConstructible";

export class SigningPolicySigned extends RawEventConstructible {
  static eventName = "SigningPolicySigned";
  constructor(data: any) {
    super();
    this.rewardEpochId = Number(data.rewardEpochId);
    this.signingPolicyAddress = data.signingPolicyAddress.toLowerCase();
    this.voter = data.voter.toLowerCase();
    this.timestamp = Number(data.timestamp);
    this.thresholdReached = Boolean(data.thresholdReached);
  }

  static fromRawEvent(event: any): SigningPolicySigned {
    return decodeEvent<SigningPolicySigned>(
      CONTRACTS.FlareSystemsManager.name,
      SigningPolicySigned.eventName,
      event,
      (data: any) => new SigningPolicySigned(data)
    );
  }

  // Reward epoch id
  rewardEpochId: number;

  // Address which signed this
  signingPolicyAddress: Address;

  // Voter (entity)
  voter: Address;

  // Timestamp when this happened
  timestamp: number;

  // Indicates if signing threshold was reached
  thresholdReached: boolean;
}
