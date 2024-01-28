import { CONTRACTS } from "../configs/networks";
import { decodeEvent } from "../utils/EncodingUtils";
import { RawEventConstructible } from "./RawEventConstructible";

/**
 * RandomAcquisitionStarted object obtained from the FlareSystemManager smart contract
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
      CONTRACTS.FlareSystemManager.name,
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
