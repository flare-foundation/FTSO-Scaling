import { MerkleTree } from "../utils/MerkleTree";
import { IRewardClaim, IRewardClaimWithProof, RewardClaim } from "../utils/RewardClaim";

/**
 * Builds a reward claim Merkle tree from the given reward epoch claims.
 */
export function buildRewardClaimMerkleTree(rewardClaims: IRewardClaim[]): MerkleTree {
  const leaves = rewardClaims.map(rewardClaim => RewardClaim.hashRewardClaim(rewardClaim));
  // assert different hashes
  const uniqueLeaves = new Set(leaves);
  if (uniqueLeaves.size !== leaves.length) {
    throw new Error("Critical error: Reward claims must have unique hashes");
  }
  return new MerkleTree(leaves);
}

/**
 * Obtains a Merkle proof for the given reward claim.
 */
export function getMerkleProof(
  rewardClaim: IRewardClaim,
  rewardClaimMerkleTree: MerkleTree
): IRewardClaimWithProof | undefined {
  const leafHash = RewardClaim.hashRewardClaim(rewardClaim);
  const proof = rewardClaimMerkleTree.getProof(leafHash);
  if (proof) {
    const proofObj: IRewardClaimWithProof = {
      merkleProof: proof,
      body: rewardClaim,
    };
    return proofObj;
  }
  return undefined;
}
