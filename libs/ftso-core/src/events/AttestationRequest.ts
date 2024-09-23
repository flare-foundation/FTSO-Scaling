import { CONTRACTS } from "../configs/networks";
import { decodeEvent } from "../utils/EncodingUtils";
import { RawEventConstructible } from "./RawEventConstructible";


export class AttestationRequest extends RawEventConstructible {
  static eventName = "AttestationRequest";
  constructor(data: any) {
    super();
    this.data = data.data;
    this.fee = BigInt(data.fee);
  }

  static fromRawEvent(event: any): AttestationRequest {
    return decodeEvent<AttestationRequest>(
      CONTRACTS.FdcHub.name,
      AttestationRequest.eventName,
      event,
      (data: any) => new AttestationRequest(data)
    );
  }

  // Feed values in the order of feedIds
  data: string;

  // feed decimals
  fee: bigint;
}
