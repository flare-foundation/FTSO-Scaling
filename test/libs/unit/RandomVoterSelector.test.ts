import { expect } from "chai";
import { ethers } from "ethers";
import { RandomVoterSelector } from "../../../libs/fsp-rewards/src/reward-calculation/RandomVoterSelector";
import Web3 from "web3";

const coder = ethers.AbiCoder.defaultAbiCoder();
const DEFAULT_THRESHOLD_BIPS = 1000;

describe("RandomVoterSelector", () => {
  const voters = [
    "0xc783df8a850f42e7f7e57013759c285caa701eb6",
    "0xead9c93b79ae7c1591b1fb5323bd777e86e150d4",
    "0xe5904695748fe4a84b40b3fc79de2277660bd1d3",
    "0x92561f28ec438ee9831d00d1d59fbdc981b762b2",
    "0x2ffd013aaa7b5a7da93336c2251075202b33fb2b",
  ];
  const weights = [100n, 200n, 300n, 400n, 500n];

  it("Should calculate initial hashes like ethers", () => {
    const protocolId = 1;
    const votingRoundId = 2;
    const rewardEpochSeed = Web3.utils.randomHex(32);

    const selectorHash = RandomVoterSelector.initialHashSeed(rewardEpochSeed, protocolId, votingRoundId);
    const abiEncoded = coder.encode(["bytes32", "uint256", "uint256"], [rewardEpochSeed, protocolId, votingRoundId]);
    const ethersHash = ethers.keccak256(abiEncoded);
    expect(selectorHash).to.equal(ethersHash);
  });

  it("Should correctly initialize", () => {
    const randomVoterSelector = new RandomVoterSelector(voters, weights, DEFAULT_THRESHOLD_BIPS);
    expect(randomVoterSelector.thresholds).to.deep.equal([0n, 100n, 300n, 600n, 1000n]);
    expect(randomVoterSelector.totalWeight).to.equal(1500n);
    expect(randomVoterSelector.votersSigningAddresses).to.deep.equal(voters);
    expect(randomVoterSelector.weights).to.deep.equal(weights);
  });

  it("Should binary search work correctly", () => {
    const randomVoterSelector1 = new RandomVoterSelector(
      ["0xc783df8a850f42e7f7e57013759c285caa701eb6"],
      [100n],
      DEFAULT_THRESHOLD_BIPS
    );
    expect(randomVoterSelector1.binarySearch(0n)).to.equal(0);
    expect(randomVoterSelector1.binarySearch(1n)).to.equal(0);
    expect(randomVoterSelector1.binarySearch(99n)).to.equal(0);
    expect(randomVoterSelector1.binarySearch(100n)).to.equal(0);
    const randomVoterSelector5 = new RandomVoterSelector(voters, weights, DEFAULT_THRESHOLD_BIPS);
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
    const rewardEpochSeed = Web3.utils.randomHex(32);
    const randomVoterSelector = new RandomVoterSelector(voters, weights, DEFAULT_THRESHOLD_BIPS);
    for (let protocolId = 1; protocolId <= 5; protocolId++) {
      for (let votingRoundId = 0; votingRoundId <= 10; votingRoundId++) {
        const initialSeed = RandomVoterSelector.initialHashSeed(rewardEpochSeed, protocolId, votingRoundId);
        const index = randomVoterSelector.selectVoterIndex(initialSeed);
        expect(index).to.be.greaterThanOrEqual(0);
        expect(index).to.be.lessThan(voters.length);
      }
    }
  });

  it("Should random generation from a predetermined seed return expected values", () => {
    const randomVoterSelector = new RandomVoterSelector(voters, weights, DEFAULT_THRESHOLD_BIPS);
    const protocolId = 1;
    const votingRoundId = 1;
    const rewardEpochSeed = "0xd95b7ddc4e3de476e066fcc8f98a0a9049d1a9f7babf759ab2ddf64931194018";
    const expected = [
      "0xa074ad99800019ff5e4d029a52cba50eabb957d28abdd9c73a165f9430f76460",
      "0x40fbc8d055fe82800694c5338691326aa2222d48aee82caa94b205472c449ffa",
      "0x300c3d8713d21d925323a3116beabc414581d802db066e67545d92be4fa0c497",
      "0x5e6e95ed94fb91b7abcafc4e004db6512e4aaae046ebba4636df9ed42688773b",
      "0xd715de2c04db332785c511abdac7cb431df9c86c2dad3bc2e32cc04ee4f20836",
    ];
    const seed = RandomVoterSelector.initialHashSeed(rewardEpochSeed, protocolId, votingRoundId);
    const randoms = randomVoterSelector.randomNumberSequence(seed, 5);
    expect(expected).to.deep.equal(randoms);
    expect(expected[0]).to.equal(seed);
  });

  it.skip("Should voters weight be over threshold and generated from expected number sequence", () => {
    const randomVoterSelector = new RandomVoterSelector(voters, weights, DEFAULT_THRESHOLD_BIPS);
    const weightThresholdBIPS = 3000;
    const thresholdWeight = (randomVoterSelector.totalWeight * BigInt(weightThresholdBIPS)) / 10000n;
    const voterWeightMap = new Map<string, bigint>();
    for (let i = 0; i < voters.length; i++) {
      voterWeightMap.set(voters[i], weights[i]);
    }
    const protocolId = 1;
    const votingRoundId = 1;
    const rewardEpochSeed = Web3.utils.randomHex(32);
    const seed = RandomVoterSelector.initialHashSeed(rewardEpochSeed, protocolId, votingRoundId);
    const result = randomVoterSelector.randomSelectThresholdWeightVoters(seed);
    let sum = 0n;
    for (const voter of result) {
      sum += voterWeightMap.get(voter)!;
    }
    expect(Number(sum)).to.be.greaterThanOrEqual(Number(thresholdWeight));
    let i = 1;
    while (true) {
      const sequence = randomVoterSelector
        .randomNumberSequence(seed, i)
        .map((s) => BigInt(s) % BigInt(randomVoterSelector.totalWeight))
        .map((n) => randomVoterSelector.binarySearch(n))
        .map((i) => voters[i]);
      const selectedVotersSet = new Set(sequence);
      if (selectedVotersSet.size === result.length) {
        let sum2 = 0n;
        for (const voter of selectedVotersSet) {
          sum2 += voterWeightMap.get(voter)!;
        }
        expect(Number(sum2)).to.be.equal(Number(sum));
        break;
      }
      i++;
    }
  });
});
