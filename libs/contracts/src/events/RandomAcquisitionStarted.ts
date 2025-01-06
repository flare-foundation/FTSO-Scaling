import { RawEventConstructible } from "./RawEventConstructible";
import {decodeEvent} from "../abi/AbiCache";
import {CONTRACTS} from "../constants";

/**
 * RandomAcquisitionStarted object obtained from the FlareSystemsManager smart contract
 * as an event RandomAcquisitionStarted.
 */
export class RandomAcquisitionStarted extends RawEventConstructible {
  static eventName = "RandomAcquisitionStarted";
  constructor(data: any) {
    super();
    this.rewardEpochId = Number(data.rewardEpochId);
    this.timestamp = Number(data.timestamp);
  }

  static fromRawEvent(event: any): RandomAcquisitionStarted {
    return decodeEvent<RandomAcquisitionStarted>(
      CONTRACTS.FlareSystemsManager.name,
      RandomAcquisitionStarted.eventName,
      event,
      (data: any) => new RandomAcquisitionStarted(data)
    );
  }

  // Reward epoch id
  rewardEpochId: number;

  // Timestamp when this happened
  timestamp: number;
}
