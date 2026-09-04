/* eslint-disable */
import { ISigningPolicy } from "../../../ftso-core/src/fsp-utils/SigningPolicy";
import { Address } from "../../../ftso-core/src/voting-types";
import { RawEventConstructible } from "./RawEventConstructible";
import { decodeEvent } from "../abi/AbiCache";
import { CONTRACTS } from "../constants";

/**
 * SigningPolicyInitialized object obtained from the Relay smart contract
 * as an event SigningPolicyInitialized.
 */
export class SigningPolicyInitialized extends RawEventConstructible implements ISigningPolicy {
  static eventName = "SigningPolicyInitialized";
  constructor(data: any) {
    super();
    this.rewardEpochId = Number(data.rewardEpochId);
    this.startVotingRoundId = Number(data.startVotingRoundId);
    this.threshold = Number(data.threshold);
    this.seed = "0x" + data.seed.toString(16).padStart(64, "0");
    this.voters = data.voters.map((v: Address) => v.toLowerCase());
    this.weights = data.weights.map((v) => Number(v));
    this.signingPolicyBytes = data.signingPolicyBytes;
    this.timestamp = Number(data.timestamp);
  }

  static fromRawEvent(event: any): SigningPolicyInitialized {
    return decodeEvent<SigningPolicyInitialized>(
      CONTRACTS.Relay.name,
      SigningPolicyInitialized.eventName,
      event,
      (data: any) => new SigningPolicyInitialized(data)
    );
  }

  /**
   * Reward epoch id
   */
  rewardEpochId: number;
  // First voting round id of validity.
  // Usually it is the first voting round of reward epoch rewardEpochId.
  // It can be later,
  // if the confirmation of the signing policy on Flare blockchain gets delayed.
  startVotingRoundId: number;
  // Confirmation threshold (absolute value of noramalised weights).
  threshold: number;
  // Random seed.
  seed: string;
  // The list of eligible voters in the canonical order.
  voters: Address[];
  // The corresponding list of normalised signing weights of eligible voters.
  // Normalisation is done by compressing the weights from 32-byte values to 2 bytes,
  // while approximately keeping the weight relations.
  weights: number[];
  // The full signing policy byte encoded.
  signingPolicyBytes: string;
  // Timestamp of the event
  timestamp: number;
  /**
   * The Relay this reward epoch is signed for and finalized on. Usually the contract that emitted the event,
   * but not at the cutover: Relay v2 is deployed holding that epoch's policy and emits nothing for it, so the
   * event comes from the Relay before it while the epoch is already signed against v2. IndexerClient resolves
   * it while merging the two Relays' events, which is where the difference is visible.
   */
  epochRelayAddress = "";
}
