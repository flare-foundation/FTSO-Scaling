import {TLPTransaction} from "../orm/entities";
import {IPayloadMessage, PayloadMessage} from "../fsp-utils/PayloadMessage";

/**
 * Decode function call data encoded using PayloadMessage
 */
export function decodePayloadMessageCalldata(tx: TLPTransaction): IPayloadMessage<string>[] {
  // input in database is hex string, without 0x, first 4 bytes are function signature
  const payloadData = tx.input!.slice(8); // dropping function signature
  return PayloadMessage.decode(payloadData);
}

export function unPrefix0x(str: string) {
  return str.startsWith("0x") ? str.slice(2) : str;
}
