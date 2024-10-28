import { CONTRACTS } from "../configs/networks";
import { decodeEvent } from "../utils/EncodingUtils";
import { RawEventConstructible } from "./RawEventConstructible";


export class AttestationRequest extends RawEventConstructible {
  static eventName = "AttestationRequest";
  constructor(data: any, timestamp: number) {
    super();
    if (timestamp === undefined) {
      throw new Error("Timestamp is required");
    }
    this.data = data.data;
    this.fee = BigInt(data.fee);
    this.timestamp = timestamp;
  }

  static fromRawEvent(event: any): AttestationRequest {
    return decodeEvent<AttestationRequest>(
      CONTRACTS.FdcHub.name,
      AttestationRequest.eventName,
      event,
      (data: any, entity: any) => new AttestationRequest(data, entity.timestamp)
    );
  }

  static getId(attestationRequest: AttestationRequest): string {
    // 0x + 64 bytes in hex
    if (attestationRequest.data.length < 130) {
      return undefined;
    }
    return attestationRequest.data.substring(0, 130);
  }

  // Feed values in the order of feedIds
  data: string;

  // feed decimals
  fee: bigint;

  // timestamp
  timestamp: number;

  // confirmed
  confirmed: boolean = false;

  // duplicate
  duplicate: boolean = false;
}
