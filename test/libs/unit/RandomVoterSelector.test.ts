import { expect } from "chai";
import { RandomVoterSelector } from "../../../libs/ftso-core/src/reward-calculation/RandomVoterSelector";
import { ethers } from "ethers";
import e from "express";

const coder = ethers.AbiCoder.defaultAbiCoder();

describe("RandomVoterSelector", () => {
   const voters = [
      "0xc783df8a850f42e7f7e57013759c285caa701eb6",
      "0xead9c93b79ae7c1591b1fb5323bd777e86e150d4",
      "0xe5904695748fe4a84b40b3fc79de2277660bd1d3",
      "0x92561f28ec438ee9831d00d1d59fbdc981b762b2",
      "0x2ffd013aaa7b5a7da93336c2251075202b33fb2b"
   ];
   const weights = [100n, 200n, 300n, 400n, 500n];

   it("Should calculate initial hashes like ethers", () => {
      const protocolId = 1;
      const votingRoundId = 2;

      const selectorHash = RandomVoterSelector.initialHashSeed(protocolId, votingRoundId);
      const abiEncoded = coder.encode(["uint256", "uint256"], [protocolId, votingRoundId]);
      const ethersHash = ethers.keccak256(abiEncoded);
      expect(selectorHash).to.equal(ethersHash);
   });

   it("Should correctly initialize", () => {
      const randomVoterSelector = new RandomVoterSelector(voters, weights);
      expect(randomVoterSelector.thresholds).to.deep.equal([0n, 100n, 300n, 600n, 1000n]);
      expect(randomVoterSelector.totalWeight).to.equal(1500n);
      expect(randomVoterSelector.voters).to.deep.equal(voters);
      expect(randomVoterSelector.weights).to.deep.equal(weights);
   });

   it("Should binary search work correctly", () => {
      const randomVoterSelector1 = new RandomVoterSelector(["0xc783df8a850f42e7f7e57013759c285caa701eb6"], [100n]);
      expect(randomVoterSelector1.binarySearch(0n)).to.equal(0);
      expect(randomVoterSelector1.binarySearch(1n)).to.equal(0);
      expect(randomVoterSelector1.binarySearch(99n)).to.equal(0);
      expect(randomVoterSelector1.binarySearch(100n)).to.equal(0);
      const randomVoterSelector5 = new RandomVoterSelector(voters, weights);
      expect(randomVoterSelector5.binarySearch(0n)).to.equal(0);
      expect(randomVoterSelector5.binarySearch(1n)).to.equal(0);
      expect(randomVoterSelector5.binarySearch(99n)).to.equal(0);
      expect(randomVoterSelector5.binarySearch(100n)).to.equal(1);
      expect(randomVoterSelector5.binarySearch(101n)).to.equal(1);
      expect(randomVoterSelector5.binarySearch(105n)).to.equal(1);
      expect(randomVoterSelector5.binarySearch(299n)).to.equal(1);
      expect(randomVoterSelector5.binarySearch(300n)).to.equal(2);
      expect(randomVoterSelector5.binarySearch(301n)).to.equal(2);
      expect(randomVoterSelector5.binarySearch(305n)).to.equal(2);
      expect(randomVoterSelector5.binarySearch(599n)).to.equal(2);
      expect(randomVoterSelector5.binarySearch(600n)).to.equal(3);
      expect(randomVoterSelector5.binarySearch(601n)).to.equal(3);
      expect(randomVoterSelector5.binarySearch(605n)).to.equal(3);
      expect(randomVoterSelector5.binarySearch(999n)).to.equal(3);
      expect(randomVoterSelector5.binarySearch(1000n)).to.equal(4);
      expect(randomVoterSelector5.binarySearch(1001n)).to.equal(4);
      expect(randomVoterSelector5.binarySearch(1005n)).to.equal(4);
      // out of range
      expect(() => randomVoterSelector5.binarySearch(-1n)).to.throw("Value must be between 0 and total weight");
      expect(() => randomVoterSelector5.binarySearch(1501n)).to.throw("Value must be between 0 and total weight");
   });

   it("Should selectVoterIndex return a valid index", () => {
      const randomVoterSelector = new RandomVoterSelector(voters, weights);
      for (let protocolId = 1; protocolId <= 5; protocolId++) {
         for (let votingRoundId = 0; votingRoundId <= 10; votingRoundId++) {
            const initialSeed = RandomVoterSelector.initialHashSeed(protocolId, votingRoundId);
            const index = randomVoterSelector.selectVoterIndex(initialSeed);
            expect(index).to.be.greaterThanOrEqual(0);
            expect(index).to.be.lessThan(voters.length);
         }
      }
   });

   it("Should random generation from a predetermined seed return expected values", () => {
      const randomVoterSelector = new RandomVoterSelector(voters, weights);
      const protocolId = 1;
      const votingRoundId = 1;
      const expected = [
         "0xcc69885fda6bcc1a4ace058b4a62bf5e179ea78fd58a1ccd71c22cc9b688792f",
         "0x66b32740ad8041bcc3b909c72d7e1afe60094ec55e3cde329b4b3a28501d826c",
         "0xe8849768804c519f1aace65015dfedfd36baa448f1498cd4a53806a470488181",
         "0x42e6195371582c144e54fb9b35f45bc228418970057066f7f1f7dcb763d81d17",
         "0xa742654b1bff4170fd0a35d8c7dc2e5a0dcf6591c7b0acfd2c9d245ad0ad40f5"
      ];
      const seed = RandomVoterSelector.initialHashSeed(protocolId, votingRoundId);
      const randoms = randomVoterSelector.randomNumberSequence(seed, 5);
      expect(expected).to.deep.equal(randoms);
      expect(expected[0]).to.equal(seed);
   });

   it("Should voters weight be over threshold and generated from expected number sequence", () => {
      const randomVoterSelector = new RandomVoterSelector(voters, weights);
      const weightThresholdBIPS = 3000;
      const thresholdWeight = randomVoterSelector.totalWeight * BigInt(weightThresholdBIPS) / 10000n;
      const voterWeightMap = new Map<string, bigint>();
      for (let i = 0; i < voters.length; i++) {
         voterWeightMap.set(voters[i], weights[i]);
      }
      const protocolId = 1;
      const votingRoundId = 1;
      const seed = RandomVoterSelector.initialHashSeed(protocolId, votingRoundId);
      const result = randomVoterSelector.randomSelectThresholdWeightVoters(seed, weightThresholdBIPS);
      let sum = 0n;
      for (let voter of result) {
         sum += voterWeightMap.get(voter)!;
      }
      expect(Number(sum)).to.be.greaterThanOrEqual(Number(thresholdWeight));
      let i = 1;
      while (true) {
         const sequence = randomVoterSelector.randomNumberSequence(seed, i)
            .map(s => BigInt(s) % BigInt(randomVoterSelector.totalWeight))
            .map(n => randomVoterSelector.binarySearch(n))
            .map(i => voters[i]);
         const selectedVotersSet = new Set(sequence);
         if (selectedVotersSet.size === result.length) {
            let sum2 = 0n;
            for (let voter of selectedVotersSet) {
               sum2 += voterWeightMap.get(voter)!;
            }
            expect(Number(sum2)).to.be.equal(Number(sum));
            break;
         }
         i++;
      }

   });


});
