import { expect } from "chai";
import { MerkleTree } from "../../../libs/ftso-core/src/utils/MerkleTree";
import { MerkleTreeStructs, TreeResult } from "../../../libs/ftso-core/src/utils/MerkleTreeStructs";
import { MedianCalculationResult, RandomCalculationResult } from "../../../libs/ftso-core/src/voting-types";
import e from "express";

describe("MerkleTree", () => {
  it("Generate 100 feeds merkle tree and extract proofs", async () => {
    const VOTING_ROUND_ID = 10;
    const nodes: { object: TreeResult; hash: string; proof: string[] }[] = [];
    const randomResult: RandomCalculationResult = {
      votingRoundId: VOTING_ROUND_ID,
      random: BigInt(Math.random() * 10000000000000000),
      isSecure: true,
    };
    nodes.push({
      object: MerkleTreeStructs.fromRandomCalculationResult(randomResult),
      hash: MerkleTreeStructs.hashRandomCalculationResult(randomResult),
      proof: [],
    });
    for (let i = 0; i < 100; i++) {
      const totalWeight = 10000000000000000;
      const medianRes = Math.random() * 1000000000;
      const delta1 = Math.random() * 1000;
      const delta2 = Math.random() * 1000;
      const median: MedianCalculationResult = {
        votingRoundId: VOTING_ROUND_ID,
        feed: { name: i.toString(16).padEnd(16, "0"), decimals: 5 },
        voters: [], // Used in calculation, not needed for merkle tree
        feedValues: [], // Used in calculation, not needed for merkle tree
        data: {
          finalMedianPrice: { value: Math.floor(medianRes), decimals: 5, isEmpty: false },
          quartile1Price: { value: Math.floor(medianRes - delta1 * 100000), decimals: 5, isEmpty: false },
          quartile3Price: { value: Math.floor(medianRes + delta2 * 100000), decimals: 5, isEmpty: false },
          participatingWeight: BigInt((Math.random() * totalWeight).toFixed(0)),
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
    expect(nodes[1].proof.length).to.eq(Math.ceil(Math.log2(nodes.length)));
  });
});
