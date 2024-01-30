import { CONTRACTS } from "../configs/networks";
import { decodeEvent } from "../utils/EncodingUtils";
import { RawEventConstructible } from "./RawEventConstructible";

export class SigningPolicySigned extends RawEventConstructible {
  static eventName = "SigningPolicySigned";
  constructor(data: any) {
    super();
    // TODO: implement, place holder for now
  }

  static fromRawEvent(event: any): SigningPolicySigned {
    return decodeEvent<SigningPolicySigned>(
      CONTRACTS.FlareSystemManager.name,
      SigningPolicySigned.eventName,
      event,
      (data: any) => new SigningPolicySigned(data)
    );
  }
}
