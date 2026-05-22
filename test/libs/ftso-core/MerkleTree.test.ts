import { assert, expect } from "chai";
import { ethers } from "ethers";
import { MerkleTree, commitHash, verifyWithMerkleProof } from "../../../libs/ftso-core/src/utils/MerkleTree";
import { getTestFile } from "../../utils/getTestFile";

describe(`MerkleTree (${getTestFile(__filename)})`, () => {
  const makeHashes = (i: number, shiftSeed = 0) =>
    new Array(i).fill(0).map((x, i) => ethers.keccak256(ethers.toBeHex(shiftSeed + i)));

  describe("structural invariants", () => {
    it("creates an empty tree from an empty array", () => {
      const tree = new MerkleTree([]);
      assert(tree.hashCount === 0);
      assert(tree.root === null);
      assert(tree.sortedHashes.length === 0);
      assert(tree.tree.length === 0);
      assert(tree.getHash(1) === null);
      assert(tree.getProof(tree.getHash(1)) === null);
    });

    it("has 2*n - 1 nodes for n input hashes", () => {
      for (let i = 1; i < 10; i++) {
        const hashes = makeHashes(i);
        const tree = new MerkleTree(hashes);
        assert(tree.tree.length === 2 * i - 1);
        assert(tree.hashCount === i);
      }
    });

    it("contains each input hash among the sorted leaves", () => {
      for (let i = 1; i < 10; i++) {
        const hashes = makeHashes(i);
        const tree = new MerkleTree(hashes);
        const sortedHashes = tree.sortedHashes;
        for (let j = 0; j < i; j++) {
          assert(sortedHashes.indexOf(hashes[j]) >= 0);
        }
      }
    });

    it("deduplicates repeated input hashes", () => {
      const tree = new MerkleTree(["0x11", "0x11", "0x22"].map((x) => ethers.zeroPadBytes(x, 32)));
      assert(tree.tree.length === 3);
    });

    it("verifies the proof for every leaf (large trees)", () => {
      for (let i = 95; i < 100; i++) {
        const hashes = makeHashes(i);
        const tree = new MerkleTree(hashes);
        for (let j = 0; j < tree.hashCount; j++) {
          const leaf = tree.getHash(j);
          const proof = tree.getProof(tree.getHash(j));
          const ver = verifyWithMerkleProof(leaf, proof, tree.root);
          expect(ver).to.be.eq(true);
        }
      }
    });

    it("rejects proofs with missing leaf/proof/root", () => {
      for (let i = 95; i < 100; i++) {
        const hashes = makeHashes(i);
        const tree = new MerkleTree(hashes);
        assert(!verifyWithMerkleProof(tree.getHash(i), [], tree.root));
        assert(!verifyWithMerkleProof("", tree.getProof(tree.getHash(i)), tree.root));
        assert(!verifyWithMerkleProof(tree.getHash(i), tree.getProof(tree.getHash(i)), ""));
      }
    });

    it("rejects a proof generated against a different tree", () => {
      for (let i = 95; i < 100; i++) {
        const hashes1 = makeHashes(i);
        const hashes2 = makeHashes(i, 1000);
        const tree1 = new MerkleTree(hashes1);
        const tree2 = new MerkleTree(hashes2);
        for (let j = 0; j < i; j++) {
          expect(verifyWithMerkleProof(tree1.getHash(j), tree1.getProof(tree1.getHash(j)), tree1.root)).to.be.true;
          expect(verifyWithMerkleProof(tree1.getHash(j), tree2.getProof(tree2.getHash(j)), tree1.root)).to.be.false;
          assert(!verifyWithMerkleProof(tree1.getHash(j), tree1.getProof(tree1.getHash(j)), tree2.root));
        }
      }
    });

    it("computes a 0x-prefixed commit hash from (root, random, address)", () => {
      const merkleRoot = new MerkleTree(makeHashes(55)).root;
      const address = "0x780023EE3B120dc5bDd21422eAfe691D9f37818D";
      const randomNum = ethers.zeroPadValue(ethers.toBeArray(1289), 32);
      assert(commitHash(merkleRoot, randomNum, address).slice(0, 2) === "0x");
    });
  });
});
