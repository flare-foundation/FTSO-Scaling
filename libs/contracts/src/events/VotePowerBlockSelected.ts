/* eslint-disable */
import { RawEventConstructible } from "./RawEventConstructible";
import { decodeEvent } from "../abi/AbiCache";
import { CONTRACTS } from "../constants";

/**
 * VotePowerBlockSelected object obtained from the FlareSystemsManager smart contract
 * as an event VotePowerBlockSelected.
 */
export class VotePowerBlockSelected extends RawEventConstructible {
  static eventName = "VotePowerBlockSelected";
  constructor(data: any) {
    super();
    this.rewardEpochId = Number(data.rewardEpochId);
    this.votePowerBlock = Number(data.votePowerBlock);
    this.timestamp = Number(data.timestamp);
  }

  static fromRawEvent(event: any): VotePowerBlockSelected {
    return decodeEvent<VotePowerBlockSelected>(
      CONTRACTS.FlareSystemsManager.name,
      VotePowerBlockSelected.eventName,
      event,
      (data: any) => new VotePowerBlockSelected(data)
    );
  }

  // Reward epoch id
  rewardEpochId: number;

  // Vote power block for given reward epoch
  votePowerBlock: number;

  // Timestamp when this happened
  timestamp: number;
}
