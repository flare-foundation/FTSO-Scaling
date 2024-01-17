import { CONTRACTS } from "../configs/networks";
import { decodeEvent } from "../utils/EncodingUtils";

import { RawEventConstructible } from "./RawEventConstructible";

/**
 * RewardOffer object obtained from the FlareSystemManager smart contract
 * as an event RewardsOffered.
 */
export class RewardEpochStarted extends RawEventConstructible {
  static eventName = "RewardEpochStarted";
  constructor(data: any) {
    super();
    this.rewardEpochId = Number(data.rewardEpochId);
    this.startVotingRoundId = Number(data.startVotingRoundId);
    this.timestamp = Number(data.timestamp)
  }
  static fromRawEvent(event: any): RewardEpochStarted {
    return decodeEvent<RewardEpochStarted>(CONTRACTS.FlareSystemManager.name, RewardEpochStarted.eventName, event, (data: any) => new RewardEpochStarted(data))
  }

  // Reward epoch id
  rewardEpochId: number

  // First voting round id of validity
  startVotingRoundId: number

  // Timestamp when this happened
  timestamp: number
}
