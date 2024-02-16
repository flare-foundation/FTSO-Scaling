import { ISignaturePayload } from "../../../fsp-utils/src/SignaturePayload";
import { GenericSubmissionData } from "../IndexerClient";
import { VoterWeights } from "../RewardEpoch";
import { EPOCH_SETTINGS, PENALTY_FACTOR } from "../configs/networks";
import { IPartialRewardOffer } from "../utils/PartialRewardOffer";
import { IPartialRewardClaim } from "../utils/RewardClaim";
import { Address, MessageHash } from "../voting-types";
import { generateSigningWeightBasedClaimsForVoter } from "./reward-signing-split";

/**
 * Calculates punishable double signing offenders.
 * Punishable double signing is considered signing the two different protocol messages with Merkle root
 * for the same voting round id and the same protocol within the voting epoch id == votingRoundId + 1.
 * This covers the grace period for signing deposition rewarding.
 * @param votingRoundId
 * @param protocolId
 * @param signatures the signatures belong to signingAddresses of registered voters only
 * @returns a set of signingAddresses of double signers
 */
export function calculateDoubleSigners(
  votingRoundId: number,
  protocolId: number,
  signatures: Map<MessageHash, GenericSubmissionData<ISignaturePayload>[]>
): Set<Address> {
  const startTime = EPOCH_SETTINGS().votingEpochStartSec(votingRoundId + 1);
  const endTime = EPOCH_SETTINGS().votingEpochEndSec(votingRoundId + 1);
  const signerCounter = new Map<Address, string>();
  const doubleSigners = new Set<Address>();

  for (const [hash, signatureList] of signatures) {
    for (const signature of signatureList) {
      if (signature.votingEpochIdFromTimestamp !== votingRoundId + 1) {
        continue;
      }
      if (signature.messages.message.protocolId !== protocolId) {
        throw new Error("Critical error: Illegal protocol id");
      }
      if (signature.timestamp < startTime || signature.timestamp > endTime) {
        // non-punishable
        continue;
      }
      const signer = signature.messages.signer!;
      const existingHash = signerCounter.get(signer);
      if (existingHash && existingHash !== hash) {
        doubleSigners.add(signer);
      } else {
        signerCounter.set(signer, hash);
      }
    }
  }
  return doubleSigners;
}

/**
 * Calculates double signing penalties for the given reward offer and signatures.
 * @param offer
 * @param doubleSigners set of submitAddresses of double signers
 * @param votersWeights
 * @param addLog
 * @returns
 */
export function calculateDoubleSigningPenalties(
  offer: IPartialRewardOffer,
  doubleSigners: Set<Address>,
  votersWeights: Map<Address, VoterWeights>,
  addLog = false
): IPartialRewardClaim[] {
  const votingRoundId = offer.votingRoundId;
  if (doubleSigners.size === 0) {
    return [];
  }
  const totalWeight = BigInt(
    [...votersWeights.values()].map(voterWeight => voterWeight.signingWeight).reduce((a, b) => a + b, 0)
  );

  const penaltyClaims: IPartialRewardClaim[] = [];
  for (const submitAddress of doubleSigners) {
    const voterWeights = votersWeights.get(submitAddress)!;
    if (!voterWeights) {
      throw new Error("Critical error: Illegal offender");
    }
    const voterWeight = BigInt(voterWeights.signingWeight);
    const penalty = (-voterWeight * offer.amount * PENALTY_FACTOR()) / totalWeight;
    penaltyClaims.push(
      ...generateSigningWeightBasedClaimsForVoter(penalty, voterWeights, offer.votingRoundId, "Double signing", addLog)
    );
  }
  return penaltyClaims;
}
