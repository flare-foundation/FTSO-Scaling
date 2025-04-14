import { ISignaturePayload } from "../../../ftso-core/src/fsp-utils/SignaturePayload";
import { GenericSubmissionData } from "../../../ftso-core/src/IndexerClient";
import { EPOCH_SETTINGS } from "../../../ftso-core/src/constants";
import { Address, MessageHash } from "../../../ftso-core/src/voting-types";

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
      // if (signature.messages.message.protocolId !== protocolId) {
      //   throw new Error("Critical error: Illegal protocol id");
      // }
      if (signature.timestamp < startTime || signature.timestamp > endTime) {
        // non-punishable
        continue;
      }
      const signer = signature.messages.signer!.toLowerCase();
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
