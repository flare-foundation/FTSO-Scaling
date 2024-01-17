import { CONTRACTS } from "../configs/networks";
import { decodeEvent } from "../utils/EncodingUtils";
import { ISigningPolicy } from "../utils/SigningPolicy";
import { Address } from "../voting-types";
import { RawEventConstructible } from "./RawEventConstructible";

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
      this.seed = data.seed;
      this.voters = data.voters.map((v: Address) => v.toLowerCase());
      this.weights = data.weights.map((v: number) => Number(v));
      this.signingPolicyBytes = data.signingPolicyBytes;
   }

   static fromRawEvent(event: any): SigningPolicyInitialized {
      return decodeEvent<SigningPolicyInitialized>(CONTRACTS.Relay.name, SigningPolicyInitialized.eventName, event, (data: any) => new SigningPolicyInitialized(data))
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
   voters: string[];
   // The corresponding list of normalised signing weights of eligible voters.
   // Normalisation is done by compressing the weights from 32-byte values to 2 bytes,
   // while approximately keeping the weight relations.
   weights: number[];
   // The full signing policy byte encoded.
   signingPolicyBytes: string;
}
