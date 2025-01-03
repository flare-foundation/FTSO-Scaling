import { TLPEvents } from "../../../ftso-core/src/orm/entities";
import { Address } from "../../../ftso-core/src/voting-types";
import { RawEventConstructible } from "./RawEventConstructible";
import {decodeEvent} from "../abi/AbiCache";
import {CONTRACTS} from "../constants";

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
