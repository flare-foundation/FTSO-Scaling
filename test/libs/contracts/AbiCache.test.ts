import { expect } from "chai";
import { AbiCache, decodeEvent } from "../../../libs/contracts/src/abi/AbiCache";
import { CONTRACTS } from "../../../libs/contracts/src/constants";
import { ContractMethodNames } from "../../../libs/contracts/src/definitions";
import {
  RewardsOffered,
  SigningPolicyInitialized,
  VoterRegistered,
  VoterRegistrationInfo,
} from "../../../libs/contracts/src/events";
import { FastUpdateFeeds } from "../../../libs/contracts/src/events/FastUpdateFeeds";
import { generateEvent } from "../../utils/basic-generators";
import { getTestFile } from "../../utils/getTestFile";

/**
 * These tests pin the ABI layer in AbiCache (event/function signatures and
 * `decodeEvent`/`Interface.decodeEventLog`). Each event is encoded the same way the indexer
 * stores it (`generateEvent`) and decoded back through `fromRawEvent`, asserting every field
 * round-trips. The shapes here deliberately cover the trickiest decode cases: multiple indexed
 * params, indexed addresses, dynamic arrays, signed int arrays, odd-size fixed bytes, and large
 * uint256 values.
 */
describe(`AbiCache (${getTestFile(__filename)})`, () => {
  const cache = AbiCache.instance;

  describe("signatures", () => {
    it("computes the known on-chain topic hash for SigningPolicyInitialized", () => {
      // Independently sourced ground truth: topic0 of a real SigningPolicyInitialized log.
      expect(cache.getEventSignature(CONTRACTS.Relay.name, SigningPolicyInitialized.eventName)).to.equal(
        "0x91d0280e969157fc6c5b8f952f237b03d934b18534dafcac839075bbc33522f8"
      );
    });

    it("produces well-formed, distinct 4-byte selectors for submission functions", () => {
      const selectors = [
        ContractMethodNames.submit1,
        ContractMethodNames.submit2,
        ContractMethodNames.submit3,
        ContractMethodNames.submitSignatures,
      ].map((fn) => cache.getFunctionSignature(CONTRACTS.Submission.name, fn));

      for (const sel of selectors) {
        expect(sel).to.match(/^0x[0-9a-f]{8}$/);
      }
      expect(new Set(selectors).size, "selectors must be distinct").to.equal(selectors.length);
    });
  });

  describe("decodeEvent round-trips", () => {
    it("VoterRegistered: three indexed params (two addresses + uint24) plus bytes32 and uint256", () => {
      const input = {
        voter: "0x" + "11".repeat(20),
        rewardEpochId: 7,
        signingPolicyAddress: "0x" + "22".repeat(20),
        submitAddress: "0x" + "33".repeat(20),
        submitSignaturesAddress: "0x" + "44".repeat(20),
        publicKeyPart1: "0x" + "ab".repeat(32),
        publicKeyPart2: "0x" + "cd".repeat(32),
        registrationWeight: 123456789012345678901234567890n,
      };
      const raw = generateEvent(CONTRACTS.VoterRegistry, VoterRegistered.eventName, input, 1, 100);
      const decoded = VoterRegistered.fromRawEvent(raw);

      expect(decoded.voter).to.equal(input.voter);
      expect(decoded.rewardEpochId).to.equal(7);
      expect(decoded.signingPolicyAddress).to.equal(input.signingPolicyAddress);
      expect(decoded.submitAddress).to.equal(input.submitAddress);
      expect(decoded.submitSignaturesAddress).to.equal(input.submitSignaturesAddress);
      expect(decoded.publicKeyPart1).to.equal(input.publicKeyPart1);
      expect(decoded.publicKeyPart2).to.equal(input.publicKeyPart2);
      expect(decoded.registrationWeight).to.equal(input.registrationWeight);
    });

    it("VoterRegistrationInfo: indexed params plus bytes20[] and uint256[] arrays", () => {
      const input = {
        voter: "0x" + "55".repeat(20),
        rewardEpochId: 9,
        delegationAddress: "0x" + "66".repeat(20),
        delegationFeeBIPS: 2000,
        wNatWeight: 1000n,
        wNatCappedWeight: 999n,
        nodeIds: ["0x" + "aa".repeat(20), "0x" + "bb".repeat(20)],
        nodeWeights: [10n, 20n, 30n],
      };
      const raw = generateEvent(CONTRACTS.FlareSystemsCalculator, VoterRegistrationInfo.eventName, input, 1, 100);
      const decoded = VoterRegistrationInfo.fromRawEvent(raw);

      expect(decoded.voter).to.equal(input.voter);
      expect(decoded.rewardEpochId).to.equal(9);
      expect(decoded.delegationAddress).to.equal(input.delegationAddress);
      expect(decoded.delegationFeeBIPS).to.equal(2000);
      expect(decoded.wNatWeight).to.equal(1000n);
      expect(decoded.wNatCappedWeight).to.equal(999n);
      expect(decoded.nodeIds).to.deep.equal(input.nodeIds);
      expect(decoded.nodeWeights).to.deep.equal(input.nodeWeights);
    });

    it("FastUpdateFeeds: uint256[] plus signed int8[] including a negative value", () => {
      const input = {
        votingEpochId: 4242,
        feeds: [1n, 2n ** 200n, 0n],
        decimals: [5, -3, 0], // int8[] — signed decode must preserve the negative
      };
      const raw = generateEvent(CONTRACTS.FastUpdater, FastUpdateFeeds.eventName, input, 1, 100);
      const decoded = FastUpdateFeeds.fromRawEvent(raw);

      expect(decoded.votingRoundId).to.equal(4242);
      expect(decoded.feeds).to.deep.equal(input.feeds);
      expect(decoded.decimals).to.deep.equal([5, -3, 0]);
    });

    it("RewardsOffered: bytes21 feedId, signed int8 decimals, and large uint256 amount", () => {
      const input = {
        rewardEpochId: 3,
        feedId: "0x01" + "ab".repeat(20), // bytes21 = 1 type byte + 20 name bytes
        decimals: -5,
        amount: 10n ** 30n,
        minRewardedTurnoutBIPS: 1000,
        primaryBandRewardSharePPM: 800000,
        secondaryBandWidthPPM: 2000,
        claimBackAddress: "0x" + "77".repeat(20),
      };
      const raw = generateEvent(CONTRACTS.FtsoRewardOffersManager, RewardsOffered.eventName, input, 1, 100);
      const decoded = RewardsOffered.fromRawEvent(raw);

      expect(decoded.rewardEpochId).to.equal(3);
      expect(decoded.feedId).to.equal(input.feedId);
      expect(decoded.decimals).to.equal(-5);
      expect(decoded.amount).to.equal(10n ** 30n);
      expect(decoded.minRewardedTurnoutBIPS).to.equal(1000);
      expect(decoded.primaryBandRewardSharePPM).to.equal(800000);
      expect(decoded.secondaryBandWidthPPM).to.equal(2000);
      expect(decoded.claimBackAddress).to.equal(input.claimBackAddress);
    });

    it("SigningPolicyInitialized: address[] / uint16[] arrays and dynamic bytes", () => {
      const input = {
        rewardEpochId: 12,
        startVotingRoundId: 3600,
        threshold: 500,
        seed: 0x123n,
        voters: ["0x" + "1a".repeat(20), "0x" + "2b".repeat(20)],
        weights: [100, 200],
        signingPolicyBytes: "0x" + "dead",
        timestamp: 1700000000,
      };
      const raw = generateEvent(CONTRACTS.Relay, SigningPolicyInitialized.eventName, input, 1, 100);
      const decoded = SigningPolicyInitialized.fromRawEvent(raw);

      expect(decoded.rewardEpochId).to.equal(12);
      expect(decoded.startVotingRoundId).to.equal(3600);
      expect(decoded.threshold).to.equal(500);
      expect(decoded.seed).to.equal("0x" + "123".padStart(64, "0"));
      expect(decoded.voters).to.deep.equal(input.voters);
      expect(decoded.weights).to.deep.equal([100, 200]);
      expect(decoded.signingPolicyBytes).to.equal("0xdead");
      expect(decoded.timestamp).to.equal(1700000000);
    });
  });

  describe("strict bytes semantics", () => {
    it("rejects odd-length bytes values", () => {
      // Bytes values must be even-length (whole-byte) hex strings; odd-length hex like
      // "0x123" is malformed and encoding it must throw rather than silently pad.
      const input = {
        rewardEpochId: 12,
        startVotingRoundId: 3600,
        threshold: 500,
        seed: 0x123n,
        voters: ["0x" + "1a".repeat(20)],
        weights: [100],
        signingPolicyBytes: "0x123",
        timestamp: 1700000000,
      };
      expect(() => generateEvent(CONTRACTS.Relay, SigningPolicyInitialized.eventName, input, 1, 100)).to.throw(
        /invalid BytesLike value/
      );
    });
  });

  describe("indexed fixed-size bytes topics", () => {
    // An indexed bytesN (N < 32) parameter is stored on-chain as a 32-byte topic, padded on the
    // right. Decoding must return the trimmed N-byte value, not the raw padded topic. These
    // tests pin that for the two such events present in the shipped ABIs (neither is decoded
    // in production code today).
    it("BeneficiaryChilled: indexed bytes20 decodes to the 20-byte value, not the padded topic", () => {
      const beneficiary = "0x" + "ab".repeat(20);
      const raw = generateEvent(
        CONTRACTS.VoterRegistry,
        "BeneficiaryChilled",
        { beneficiary, untilRewardEpochId: 42n },
        1,
        100
      );
      const decoded = decodeEvent("VoterRegistry", "BeneficiaryChilled", raw, (result) => ({
        beneficiary: result.beneficiary as string,
        untilRewardEpochId: result.untilRewardEpochId as bigint,
      }));

      expect(decoded.beneficiary).to.equal(beneficiary);
      expect((decoded.beneficiary.length - 2) / 2, "must be 20 bytes, not the 32-byte topic").to.equal(20);
      expect(decoded.untilRewardEpochId).to.equal(42n);
    });

    it("FastUpdateFeedReset: indexed bytes21 feed id decodes to the 21-byte value", () => {
      const feedId = "0x01" + "cd".repeat(20); // bytes21 = 1 type byte + 20 name bytes
      const raw = generateEvent(
        CONTRACTS.FastUpdater,
        "FastUpdateFeedReset",
        { votingRoundId: 4242n, index: 3n, id: feedId, value: 10n ** 18n, decimals: -2 },
        1,
        100
      );
      const decoded = decodeEvent("FastUpdater", "FastUpdateFeedReset", raw, (result) => ({
        votingRoundId: result.votingRoundId as bigint,
        index: result.index as bigint,
        id: result.id as string,
        value: result.value as bigint,
        decimals: result.decimals as bigint,
      }));

      expect(decoded.votingRoundId).to.equal(4242n);
      expect(decoded.index).to.equal(3n);
      expect(decoded.id).to.equal(feedId);
      expect((decoded.id.length - 2) / 2, "must be 21 bytes, not the 32-byte topic").to.equal(21);
      expect(decoded.value).to.equal(10n ** 18n);
      expect(decoded.decimals).to.equal(-2n);
    });
  });
});
