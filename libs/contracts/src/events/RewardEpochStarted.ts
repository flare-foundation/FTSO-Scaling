/* eslint-disable */
import { RawEventConstructible } from "./RawEventConstructible";
import { decodeEvent } from "../abi/AbiCache";
import { CONTRACTS } from "../constants";

/**
 * RewardOffer object obtained from the FlareSystemsManager smart contract
 * as an event RewardsOffered.
 */
export class RewardEpochStarted extends RawEventConstructible {
  static eventName = "RewardEpochStarted";
  constructor(data: any) {
    super();
    this.rewardEpochId = Number(data.rewardEpochId);
    this.startVotingRoundId = Number(data.startVotingRoundId);
    this.timestamp = Number(data.timestamp);
  }
  static fromRawEvent(event: any): RewardEpochStarted {
    return decodeEvent<RewardEpochStarted>(
      CONTRACTS.FlareSystemsManager.name,
      RewardEpochStarted.eventName,
      event,
      (data: any) => new RewardEpochStarted(data)
    );
  }

  // Reward epoch id
  rewardEpochId: number;

  // First voting round id of validity
  startVotingRoundId: number;

  // Timestamp when this happened
  timestamp: number;
}
