import { expect } from "chai";
import { MerkleTree } from "../../../libs/ftso-core/src/utils/MerkleTree";
import { MerkleTreeStructs, TreeResult } from "../../../libs/ftso-core/src/utils/MerkleTreeStructs";
import { MedianCalculationResult, RandomCalculationResult } from "../../../libs/ftso-core/src/voting-types";
import Prando from "prando";
import { toFeedId } from "../../utils/generators";

describe("MerkleTree", () => {
  const random = new Prando(42);

  it("Generate 100 feeds merkle tree and extract proofs", async () => {
    const VOTING_ROUND_ID = 10;
    const nodes: { object: TreeResult; hash: string; proof: string[] }[] = [];
    const randomResult: RandomCalculationResult = {
      votingRoundId: VOTING_ROUND_ID,
      random: BigInt(random.nextInt(0, 10000000000000000)),
      isSecure: true,
    };
    nodes.push({
      object: MerkleTreeStructs.fromRandomCalculationResult(randomResult),
      hash: MerkleTreeStructs.hashRandomCalculationResult(randomResult),
      proof: [],
    });
    for (let i = 0; i < 100; i++) {
      const totalWeight = 10000000000000000;
      const medianRes = random.nextInt(0, 1000000000);
      const delta1 = random.nextInt(0, 1000);
      const delta2 = random.nextInt(0, 1000);
      const median: MedianCalculationResult = {
        votingRoundId: VOTING_ROUND_ID,
        feed: { id: toFeedId(i.toString()), decimals: 5 },
        votersSubmitAddresses: [], // Used in calculation, not needed for merkle tree
        feedValues: [], // Used in calculation, not needed for merkle tree
        data: {
          finalMedian: { value: Math.floor(medianRes), decimals: 5, isEmpty: false },
          quartile1: { value: Math.floor(medianRes - delta1 * 100000), decimals: 5, isEmpty: false },
          quartile3: { value: Math.floor(medianRes + delta2 * 100000), decimals: 5, isEmpty: false },
          participatingWeight: BigInt(random.nextInt(0, totalWeight)),
        },
        weights: [], // Used in calculation, not needed for merkle tree
        totalVotingWeight: BigInt(totalWeight),
      };
      nodes.push({
        object: MerkleTreeStructs.fromMedianCalculationResult(median),
        hash: MerkleTreeStructs.hashMedianCalculationResult(median),
        proof: [],
      });
    }

    const merkleTree = new MerkleTree(nodes.map(n => n.hash));

    for (const node of nodes) {
      node.proof = merkleTree.getProof(node.hash);
    }

    expect(merkleTree.root).to.be.not.undefined;

    expect(nodes[1].proof).to.be.not.undefined;
    expect(nodes.length).to.eq(101);
    expect(nodes[1].proof.length).to.eq(Math.floor(Math.log2(nodes.length)));
  });
});
