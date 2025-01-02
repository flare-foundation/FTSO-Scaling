import { CommitData, ICommitData } from "../../../libs/ftso-core/src/data/CommitData";
import { IPayloadMessage, PayloadMessage } from "../../../libs/ftso-core/src/fsp-utils/PayloadMessage";
import { IRevealData, RevealData } from "../../../libs/ftso-core/src/data/RevealData";

/**
 * Encodes commit data payload message to bytes in 0x-prefixed hex string format
 */
export function encodeCommitPayloadMessage(data: IPayloadMessage<ICommitData>): string {
  const msg: IPayloadMessage<string> = {
    ...data,
    payload: CommitData.encode(data.payload),
  };
  return PayloadMessage.encode(msg);
}

/**
 * Encodes reveal data payload message to bytes in 0x-prefixed hex string format
 */
export function encodeRevealPayloadMessage(data: IPayloadMessage<IRevealData>): string {
  const msg: IPayloadMessage<string> = {
    ...data,
    payload: RevealData.encode(data.payload),
  };
  return PayloadMessage.encode(msg);
}
