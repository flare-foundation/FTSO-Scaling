import { RewardClaim, RewardClaimWithProof } from "../lib/voting-interfaces";
import { hashRewardClaim } from "../lib/voting-utils";
import { MerkleTree } from "../utils/MerkleTree";

export function generateProofsForClaims(allClaims: readonly RewardClaim[], mroot: string, claimer: string) {
  const allHashes = allClaims.map(claim => hashRewardClaim(claim));
  const merkleTree = new MerkleTree(allHashes);
  if (merkleTree.root !== mroot) {
    throw new Error("Invalid Merkle root for reward claims");
  }

  const claimsWithProof: RewardClaimWithProof[] = [];
  for (let i = 0; i < allClaims.length; i++) {
    const claim = allClaims[i];
    if (claim.beneficiary.toLowerCase() === claimer.toLowerCase()) {
      claimsWithProof.push({
        merkleProof: getProof(i),
        body: claim,
      });
    }
  }

  return claimsWithProof;

  function getProof(i: number) {
    const proof = merkleTree.getProof(allHashes[i]);
    if (!proof) throw new Error(`No Merkle proof exists for claim hash ${allHashes[i]}`);
    return proof;
  }
}
