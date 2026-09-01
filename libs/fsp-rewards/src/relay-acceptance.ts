import { MerkleTreeStructs } from "../../ftso-core/src/data/MerkleTreeStructs";
import { IRelayMessage } from "../../ftso-core/src/fsp-utils/RelayMessage";
import { verifyWithMerkleProof } from "../../ftso-core/src/utils/MerkleTree";

/**
 * Throws unless the relay message carries what Relay v2 checks on the random number generating protocol:
 * the random number and a Merkle proof that folds to the merkle root the signatures ratified.
 * The leaf is the contract's — keccak256(abi.encode(votingRoundId, value, isSecure)) — with the round
 * and the secure flag taken from the signed message and only the value from the calldata, so the calldata
 * cannot claim a round or a flag of its own.
 */
export function assertRandomProvesRoot(relayMessage: IRelayMessage): void {
  const message = relayMessage.protocolMessageMerkleRoot;
  if (message === undefined) {
    throw new Error("Relay message carries no protocol message for the random number to prove against");
  }
  const randomWithProof = relayMessage.randomWithProof;
  if (randomWithProof === undefined) {
    throw new Error("Missing or misaligned random number and proof");
  }
  const leaf = MerkleTreeStructs.hashRandomResult({
    votingRoundId: message.votingRoundId,
    value: randomWithProof.randomNumber,
    isSecure: message.isSecureRandom,
  });
  if (!verifyWithMerkleProof(leaf, randomWithProof.merkleProof, message.merkleRoot)) {
    throw new Error(
      `Random number ${randomWithProof.randomNumber} does not prove against merkle root ${message.merkleRoot}`
    );
  }
}
