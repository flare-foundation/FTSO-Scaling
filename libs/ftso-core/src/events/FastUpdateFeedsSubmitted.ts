import { CONTRACTS } from "../configs/networks";
import { TLPEvents } from "../orm/entities";
import { decodeEvent } from "../utils/EncodingUtils";
import { Address } from "../voting-types";
import { RawEventConstructible } from "./RawEventConstructible";

export class FastUpdateFeedsSubmitted extends RawEventConstructible {
  static eventName = "FastUpdateFeedsSubmitted";
  constructor(data: any, entity?: TLPEvents) {
    super();
    this.votingRoundId = Number(data.votingRoundId);
    this.signingPolicyAddress = data.signingPolicyAddress.toLowerCase();
  }

  static fromRawEvent(event: any): FastUpdateFeedsSubmitted {
    return decodeEvent<FastUpdateFeedsSubmitted>(
      CONTRACTS.FastUpdater.name,
      FastUpdateFeedsSubmitted.eventName,
      event,
      (data: any, entityData?: TLPEvents) => new FastUpdateFeedsSubmitted(data, entityData)
    );
  }

  // votingRoundId
  votingRoundId: number;

  // Address of sender of the fast update (signing policy address)
  signingPolicyAddress: Address;
}
