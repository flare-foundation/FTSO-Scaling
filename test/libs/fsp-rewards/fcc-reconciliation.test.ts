import { expect } from "chai";
import { makeError } from "ethers";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path/posix";
import { bigIntReplacer } from "../../../libs/ftso-core/src/utils/big-number-serialization";
import { BURN_ADDRESS, CALCULATIONS_FOLDER, FCC_FEES_ADDRESS } from "../../../libs/fsp-rewards/src/constants";
import { ILogger } from "../../../libs/ftso-core/src/utils/ILogger";
import {
  allReconciliationChecks,
  assertFccReconciliation,
  calculatorCoveredInflationRewardsWei,
  computeFccReconciliation,
  coston2ValidatorInflationRewardsWei,
  FccReconciliation,
  FccReconciliationReport,
  fundsFullyClaimedCheck,
  logFccReconciliationSummary,
  rewardManagerExcludedRewardsWei,
} from "../../../libs/fsp-rewards/src/reward-calculation/fcc/fcc-reconciliation";
import { isRewardManagerTransportError } from "../../../libs/fsp-rewards/src/reward-calculation/fcc/reward-manager-totals";
import { RewardTypePrefix } from "../../../libs/fsp-rewards/src/reward-calculation/RewardTypePrefix";
import { ClaimType, IPartialRewardClaim, IRewardClaim } from "../../../libs/fsp-rewards/src/utils/RewardClaim";
import { CLAIMS_FILE, REWARD_CALCULATION_DATA_FILE } from "../../../libs/fsp-rewards/src/utils/stat-info/constants";
import { serializeRewardDistributionData } from "../../../libs/fsp-rewards/src/utils/stat-info/reward-distribution-data";
import { RewardEpochInfo } from "../../../libs/fsp-rewards/src/utils/stat-info/reward-epoch-info";
import { getTestFile } from "../../utils/getTestFile";

const REWARD_EPOCH_ID = 997755;
const START_VOTING_ROUND_ID = 2000;
const END_VOTING_ROUND_ID = 2001;
const INSTRUCTION_ID_A = "0x" + "aa".repeat(32);
const INSTRUCTION_ID_B = "0x" + "bb".repeat(32);

interface TeeFixture {
  fee: bigint;
  instructionId?: string;
  rewardEpochId?: number;
}
interface Fdc2Fixture {
  fee: bigint;
  instructionId?: string;
}
interface RoundFixture {
  tee?: TeeFixture[];
  fdc2?: Fdc2Fixture[];
  // counters the collection stage records; the reconciliation reads them rather than recomputing
  excludedByEpoch?: number;
  unpaired?: number;
  // omit fccData entirely, as a round serialized before FCC accounting existed would be
  omitFccData?: boolean;
  // FCC claim amounts written to claims.json; defaults to the observed sums
  claimedTee?: bigint;
  claimedFdc2?: bigint;
  // write the claims as RewardClaim.merge would leave them: correct amounts, no tags
  serializeMerged?: boolean;
}

function rewardEpochInflationInfo(ftsoWei: bigint, fastUpdatesWei: bigint, fdcWei: bigint): RewardEpochInfo {
  return {
    rewardOffers: { inflationOffers: [{ amount: ftsoWei }] },
    fuInflationRewardsOffered: { amount: fastUpdatesWei },
    fdcInflationRewardsOffered: { amount: fdcWei },
  } as unknown as RewardEpochInfo;
}

/**
 * Writes the calculation artifacts the reconciliation reads: per-round reward calculation data and partial claims,
 * plus the final reward distribution data for the epoch.
 */
function writeFixture(rounds: Record<number, RoundFixture>, finalFccClaimAmount?: bigint): string {
  const calculationFolder = CALCULATIONS_FOLDER();
  const rewardEpochFolder = path.join(calculationFolder, `${REWARD_EPOCH_ID}`);
  rmSync(rewardEpochFolder, { recursive: true, force: true });
  mkdirSync(rewardEpochFolder, { recursive: true });

  let observedTotal = 0n;
  for (let votingRoundId = START_VOTING_ROUND_ID; votingRoundId <= END_VOTING_ROUND_ID; votingRoundId++) {
    const fixture = rounds[votingRoundId] ?? {};
    const tee = fixture.tee ?? [];
    const fdc2 = fixture.fdc2 ?? [];
    const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
    mkdirSync(votingRoundFolder, { recursive: true });

    const fccData = fixture.omitFccData
      ? undefined
      : {
          votingRoundId,
          teeInstructions: tee.map((event) => ({
            extensionId: 0n,
            instructionId: event.instructionId ?? INSTRUCTION_ID_A,
            rewardEpochId: event.rewardEpochId ?? REWARD_EPOCH_ID,
            opType: "0x" + "00".repeat(32),
            opCommand: "0x" + "00".repeat(32),
            claimBackAddress: FCC_FEES_ADDRESS,
            fee: event.fee,
            timestamp: 0,
          })),
          fdc2AttestationRequests: fdc2.map((event) => ({
            instructionId: event.instructionId ?? INSTRUCTION_ID_A,
            attestationType: "0x" + "61".repeat(32),
            sourceId: "0x" + "62".repeat(32),
            proofOwner: FCC_FEES_ADDRESS,
            claimBackAddress: FCC_FEES_ADDRESS,
            fee: event.fee,
            timestamp: 0,
          })),
          eventsExcludedByRewardEpochId: fixture.excludedByEpoch ?? 0,
          unpairedFdc2Requests: fixture.unpaired ?? 0,
        };
    writeFileSync(
      path.join(votingRoundFolder, REWARD_CALCULATION_DATA_FILE),
      JSON.stringify({ fccData }, bigIntReplacer)
    );

    const teeSum = tee.reduce((total, event) => total + event.fee, 0n);
    const fdc2Sum = fdc2.reduce((total, event) => total + event.fee, 0n);
    const claimedTee = fixture.claimedTee ?? teeSum;
    const claimedFdc2 = fixture.claimedFdc2 ?? fdc2Sum;
    observedTotal += teeSum + fdc2Sum;

    const claims: IPartialRewardClaim[] = [];
    if (claimedTee > 0n) {
      claims.push({
        votingRoundId,
        beneficiary: FCC_FEES_ADDRESS.toLowerCase(),
        amount: claimedTee,
        claimType: ClaimType.DIRECT,
        protocolTag: "FCC",
        rewardTypeTag: RewardTypePrefix.FCC_TEE_FEES,
      });
    }
    if (claimedFdc2 > 0n) {
      claims.push({
        votingRoundId,
        beneficiary: FCC_FEES_ADDRESS.toLowerCase(),
        amount: claimedFdc2,
        claimType: ClaimType.DIRECT,
        protocolTag: "FCC",
        rewardTypeTag: RewardTypePrefix.FCC_FDC2_FEES,
      });
    }
    const serialized = fixture.serializeMerged
      ? [
          {
            beneficiary: FCC_FEES_ADDRESS.toLowerCase(),
            amount: claimedTee + claimedFdc2,
            claimType: ClaimType.DIRECT,
          } as IPartialRewardClaim,
        ]
      : claims;
    writeFileSync(path.join(votingRoundFolder, CLAIMS_FILE), JSON.stringify(serialized, bigIntReplacer));
  }

  const finalClaims: IRewardClaim[] = [
    {
      rewardEpochId: REWARD_EPOCH_ID,
      beneficiary: FCC_FEES_ADDRESS.toLowerCase(),
      amount: finalFccClaimAmount ?? observedTotal,
      claimType: ClaimType.DIRECT,
    },
  ];
  serializeRewardDistributionData(REWARD_EPOCH_ID, finalClaims, false, calculationFolder);
  return calculationFolder;
}

describe(`FCC reconciliation (${getTestFile(__filename)})`, () => {
  after(() => {
    const rewardEpochFolder = path.join(CALCULATIONS_FOLDER(), `${REWARD_EPOCH_ID}`);
    if (existsSync(rewardEpochFolder)) {
      rmSync(rewardEpochFolder, { recursive: true });
    }
  });

  it("balances when every observed fee is claimed", () => {
    const calculationFolder = writeFixture({
      [START_VOTING_ROUND_ID]: { tee: [{ fee: 600n }], fdc2: [{ fee: 400n }] },
      [END_VOTING_ROUND_ID]: { tee: [{ fee: 250n }], fdc2: [] },
    });
    const reconciliation = computeFccReconciliation(
      REWARD_EPOCH_ID,
      START_VOTING_ROUND_ID,
      END_VOTING_ROUND_ID,
      calculationFolder
    );
    expect(reconciliation.teeFeesWei).to.eq(850n);
    expect(reconciliation.fdc2FeesWei).to.eq(400n);
    expect(reconciliation.observedFeesWei).to.eq(1250n);
    expect(reconciliation.claimedFeesWei).to.eq(1250n);
    expect(reconciliation.residualWei).to.eq(0n);
    expect(reconciliation.finalDirectClaimToFccAddressWei).to.eq(1250n);
    expect(reconciliation.votingRoundsWithFccActivity).to.eq(2);
    expect(reconciliation.unpairedFdc2Requests).to.eq(0);
    expect(reconciliation.eventsExcludedByRewardEpochId).to.eq(0);
    expect(reconciliation.roundsWithoutFccData).to.eq(0);
    expect(() => assertFccReconciliation(reconciliation)).to.not.throw();
  });

  it("fails hard when the claims fall short of the observed fees", () => {
    const calculationFolder = writeFixture({
      [START_VOTING_ROUND_ID]: { tee: [{ fee: 600n }], fdc2: [{ fee: 400n }], claimedTee: 500n },
    });
    const reconciliation = computeFccReconciliation(
      REWARD_EPOCH_ID,
      START_VOTING_ROUND_ID,
      END_VOTING_ROUND_ID,
      calculationFolder
    );
    expect(reconciliation.residualWei).to.eq(100n);
    expect(() => assertFccReconciliation(reconciliation)).to.throw("FCC reconciliation failed");
  });

  // No tolerance: the fee events map one to one onto the receiveRewards credits, so nothing can round away.
  it("fails hard on a residual of a single wei", () => {
    const calculationFolder = writeFixture({
      [START_VOTING_ROUND_ID]: { tee: [{ fee: 600n }], claimedTee: 599n },
    });
    const reconciliation = computeFccReconciliation(
      REWARD_EPOCH_ID,
      START_VOTING_ROUND_ID,
      END_VOTING_ROUND_ID,
      calculationFolder
    );
    expect(reconciliation.residualWei).to.eq(1n);
    expect(() => assertFccReconciliation(reconciliation)).to.throw("FCC reconciliation failed");
  });

  it("fails hard when the final distribution carries less than the observed FCC fees", () => {
    const calculationFolder = writeFixture(
      { [START_VOTING_ROUND_ID]: { tee: [{ fee: 600n }], fdc2: [{ fee: 400n }] } },
      999n // final distribution is one wei short of the observed 1000n
    );
    const reconciliation = computeFccReconciliation(
      REWARD_EPOCH_ID,
      START_VOTING_ROUND_ID,
      END_VOTING_ROUND_ID,
      calculationFolder
    );
    expect(reconciliation.residualWei).to.eq(0n);
    expect(() => assertFccReconciliation(reconciliation)).to.throw("FCC fees were lost");
  });

  // On the test networks FCC_FEES_ADDRESS is the dead address, which is also the burn and FIRE pool address, so the
  // merged DIRECT claim for it carries every burned reward too and is legitimately far larger than the FCC fees.
  // Asserting equality here would fail every epoch on those networks.
  it("tolerates a final claim larger than the FCC fees when the address is shared with the burn address", () => {
    expect(FCC_FEES_ADDRESS.toLowerCase()).to.eq(BURN_ADDRESS.toLowerCase());

    const calculationFolder = writeFixture(
      { [START_VOTING_ROUND_ID]: { tee: [{ fee: 600n }], fdc2: [{ fee: 400n }] } },
      1000n + 349_255_817_897_276_966_360_606n // FCC fees plus unrelated burned rewards
    );
    const reconciliation = computeFccReconciliation(
      REWARD_EPOCH_ID,
      START_VOTING_ROUND_ID,
      END_VOTING_ROUND_ID,
      calculationFolder
    );
    expect(reconciliation.residualWei).to.eq(0n);
    expect(() => assertFccReconciliation(reconciliation)).to.not.throw();
  });

  // Every FDC2 request emits both events in one transaction, and the FDC2 event carries no reward epoch id of its
  // own, so an unpaired one cannot be attributed to any epoch at all.
  it("fails hard when an FDC2 request has no paired TeeInstructionsSent event", () => {
    const calculationFolder = writeFixture({
      [START_VOTING_ROUND_ID]: {
        tee: [{ fee: 600n, instructionId: INSTRUCTION_ID_A }],
        fdc2: [{ fee: 400n, instructionId: INSTRUCTION_ID_B }],
        unpaired: 1,
      },
    });
    const reconciliation = computeFccReconciliation(
      REWARD_EPOCH_ID,
      START_VOTING_ROUND_ID,
      END_VOTING_ROUND_ID,
      calculationFolder
    );
    expect(reconciliation.unpairedFdc2Requests).to.eq(1);
    expect(() => assertFccReconciliation(reconciliation)).to.throw("no paired TeeInstructionsSent");
  });

  // Events belonging to a neighbouring epoch are filtered out at collection, because the funding window
  // deliberately overshoots both boundaries. Their count is informational and must never fail the epoch.
  it("reports boundary exclusions without failing", () => {
    const calculationFolder = writeFixture({
      [START_VOTING_ROUND_ID]: { tee: [{ fee: 600n }], excludedByEpoch: 2 },
    });
    const reconciliation = computeFccReconciliation(
      REWARD_EPOCH_ID,
      START_VOTING_ROUND_ID,
      END_VOTING_ROUND_ID,
      calculationFolder
    );
    expect(reconciliation.eventsExcludedByRewardEpochId).to.eq(2);
    expect(() => assertFccReconciliation(reconciliation)).to.not.throw();
  });

  // The failure the observed-versus-claimed comparison structurally cannot see: both of its sides read these same
  // artifacts, so a round with no fccData contributes zero to each and the epoch appears to balance.
  it("fails hard when a voting round carries no FCC data at all", () => {
    const calculationFolder = writeFixture({
      [START_VOTING_ROUND_ID]: { tee: [{ fee: 600n }] },
      [END_VOTING_ROUND_ID]: { omitFccData: true },
    });
    const reconciliation = computeFccReconciliation(
      REWARD_EPOCH_ID,
      START_VOTING_ROUND_ID,
      END_VOTING_ROUND_ID,
      calculationFolder
    );
    expect(reconciliation.roundsWithoutFccData).to.eq(1);
    expect(reconciliation.residualWei).to.eq(0n);
    expect(() => assertFccReconciliation(reconciliation)).to.throw("have no fccData");
  });

  // RewardClaim.merge drops rewardTypeTag. If merged claims reach disk the tag sums read zero, which looks
  // identical to the fees having been lost. The message must tell the two apart.
  it("diagnoses erased tags rather than reporting lost funds", () => {
    const calculationFolder = writeFixture({
      [START_VOTING_ROUND_ID]: { tee: [{ fee: 600n }], fdc2: [{ fee: 400n }], serializeMerged: true },
    });
    const reconciliation = computeFccReconciliation(
      REWARD_EPOCH_ID,
      START_VOTING_ROUND_ID,
      END_VOTING_ROUND_ID,
      calculationFolder
    );
    expect(reconciliation.claimedFeesWei).to.eq(0n);
    expect(reconciliation.untaggedDirectClaimsToFccAddress).to.eq(1);
    expect(() => assertFccReconciliation(reconciliation)).to.throw("The fees are not lost, the tags");
  });

  // The invariant the whole feature exists for: every wei the RewardManager holds is covered by a claim. Verified
  // to hold exactly on both production networks at reward epoch 418.
  describe("all funds are covered by claims", () => {
    function report(totalClaimsWei: bigint, heldWei?: bigint): FccReconciliationReport {
      const calculationFolder = writeFixture({ [START_VOTING_ROUND_ID]: { tee: [{ fee: 600n }] } });
      const base = computeFccReconciliation(
        REWARD_EPOCH_ID,
        START_VOTING_ROUND_ID,
        END_VOTING_ROUND_ID,
        calculationFolder
      );
      return {
        ...base,
        totalClaimsWei,
        rewardManagerTotalRewardsWei: heldWei,
        rewardManagerResidualWei: heldWei === undefined ? undefined : totalClaimsWei - heldWei,
      };
    }

    it("passes when the claims exactly cover the funds held", () => {
      const check = fundsFullyClaimedCheck(report(1_000n, 1_000n));
      expect(check?.passed).to.eq(true);
    });

    it("fails when funds are left unclaimed, naming the amount", () => {
      const check = fundsFullyClaimedCheck(report(700n, 1_000n));
      expect(check?.passed).to.eq(false);
      expect(check?.detail).to.contain("300 wei unclaimed");
    });

    it("fails when more is claimed than the RewardManager holds", () => {
      const check = fundsFullyClaimedCheck(report(1_200n, 1_000n));
      expect(check?.passed).to.eq(false);
      expect(check?.detail).to.contain("claims exceed claimable funds by 200 wei");
      expect(check?.detail).to.not.contain("-200 wei unclaimed");
    });

    it("excludes Coston2's exact validator allocation across per-receiver rounding", () => {
      const epochs = [
        {
          rewardEpochId: 5877,
          ftsoWei: 850_694_444_444_444_444_444_445n,
          fastUpdatesWei: 364_583_333_333_333_333_333_334n,
          fdcWei: 1_215_277_777_777_777_777_777_778n,
          totalInflationRewardsWei: 3_472_222_222_222_222_222_222_224n,
          validatorWei: 1_041_666_666_666_666_666_666_667n,
        },
        {
          rewardEpochId: 5878,
          ftsoWei: 850_694_444_444_444_444_444_444n,
          fastUpdatesWei: 364_583_333_333_333_333_333_333n,
          fdcWei: 1_215_277_777_777_777_777_777_777n,
          totalInflationRewardsWei: 3_472_222_222_222_222_222_222_221n,
          validatorWei: 1_041_666_666_666_666_666_666_667n,
        },
      ];

      for (const epoch of epochs) {
        const coveredWei = calculatorCoveredInflationRewardsWei(
          rewardEpochInflationInfo(epoch.ftsoWei, epoch.fastUpdatesWei, epoch.fdcWei)
        );
        const excludedWei = coston2ValidatorInflationRewardsWei(epoch.totalInflationRewardsWei, coveredWei);
        expect(excludedWei, `reward epoch ${epoch.rewardEpochId}`).to.eq(epoch.validatorWei);
        expect(
          rewardManagerExcludedRewardsWei("coston2", epoch.totalInflationRewardsWei, coveredWei),
          `reward epoch ${epoch.rewardEpochId}`
        ).to.eq(epoch.validatorWei);
      }

      // Epoch 5878 is the rounding counterexample: 30% of the aggregate is one wei below the exact validator offer.
      expect((epochs[1].totalInflationRewardsWei * 3_000n) / 10_000n).to.eq(epochs[1].validatorWei - 1n);

      const totalInflationRewardsWei = epochs[1].totalInflationRewardsWei;
      const excludedValidatorRewardsWei = epochs[1].validatorWei;
      const heldWei = totalInflationRewardsWei + 2_900_000_000_000_000_000n;
      const claimsWei = heldWei - excludedValidatorRewardsWei;
      const coston2Report = report(claimsWei, heldWei);
      coston2Report.rewardManagerTotalInflationRewardsWei = totalInflationRewardsWei;
      coston2Report.calculatorCoveredInflationRewardsWei = totalInflationRewardsWei - excludedValidatorRewardsWei;
      coston2Report.rewardManagerExcludedRewardsWei = excludedValidatorRewardsWei;
      coston2Report.rewardManagerResidualWei = 0n;

      const check = fundsFullyClaimedCheck(coston2Report);
      expect(check?.passed).to.eq(true);
      expect(check?.detail).to.contain(`${excludedValidatorRewardsWei} wei of exact Coston2 validator inflation`);
    });

    it("fails closed when Coston2 covered-inflation inputs are absent or inconsistent", () => {
      const missingFastUpdates = {
        rewardOffers: { inflationOffers: [{ amount: 700n }] },
        fdcInflationRewardsOffered: { amount: 100n },
      } as unknown as RewardEpochInfo;
      expect(() => calculatorCoveredInflationRewardsWei(missingFastUpdates)).to.throw(
        "requires the Fast Updates inflation reward offer"
      );
      expect(() => rewardManagerExcludedRewardsWei("coston2", 1_000n)).to.throw(
        "requires the calculator-covered inflation total"
      );
      expect(() => coston2ValidatorInflationRewardsWei(999n, 1_000n)).to.throw("exceeds the on-chain total");
    });

    it("still fails Coston2 for any discrepancy beyond the explicit validator allocation", () => {
      const coston2Report = report(699n, 1_000n);
      coston2Report.rewardManagerTotalInflationRewardsWei = 1_000n;
      coston2Report.rewardManagerExcludedRewardsWei = 300n;
      coston2Report.rewardManagerResidualWei = -1n;

      const check = fundsFullyClaimedCheck(coston2Report);
      expect(check?.passed).to.eq(false);
      expect(check?.detail).to.contain("leaving 1 wei unclaimed");
    });

    it("does not apply the Coston2 exclusion to an ordinary report", () => {
      for (const network of ["flare", "songbird", "coston", "local-test", "from-env"] as const) {
        expect(rewardManagerExcludedRewardsWei(network, 1_000n), network).to.eq(0n);
      }
      const check = fundsFullyClaimedCheck(report(700n, 1_000n));
      expect(check?.passed).to.eq(false);
      expect(check?.detail).to.contain("leaving 300 wei unclaimed");
    });

    // An unreachable node is an environment problem, not an accounting one, so it must not fail the epoch.
    it("is skipped when the RewardManager totals could not be read", () => {
      expect(fundsFullyClaimedCheck(report(700n, undefined))).to.eq(undefined);
      const checks = allReconciliationChecks(report(700n, undefined));
      expect(checks.some((c) => c.name.includes("RewardManager funds"))).to.eq(false);
    });

    it("is included among the checks when the totals are available", () => {
      const checks = allReconciliationChecks(report(700n, 1_000n));
      const funds = checks.find((c) => c.name.includes("RewardManager funds"));
      expect(funds?.passed).to.eq(false);
    });
  });

  describe("RewardManager RPC failure classification", () => {
    it("skips only recognized transport failures", () => {
      const timeout = makeError("request timed out", "TIMEOUT", {
        operation: "request",
        reason: "timeout",
      });
      const refused = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED", syscall: "connect" });
      const discoveryFailure = makeError("network discovery failed", "NETWORK_ERROR", {
        event: "initial-network-discovery",
        info: { error: refused },
      });

      expect(isRewardManagerTransportError(timeout)).to.eq(true);
      expect(isRewardManagerTransportError(refused)).to.eq(true);
      expect(isRewardManagerTransportError(discoveryFailure)).to.eq(true);
      expect(isRewardManagerTransportError({ code: "UNKNOWN_ERROR", cause: { code: "ENOTFOUND" } })).to.eq(true);
      expect(isRewardManagerTransportError({ code: "EPERM", syscall: "connect" })).to.eq(true);
    });

    it("fails closed for configuration, ABI, decoding, and contract-call errors", () => {
      const changedNetwork = makeError("network changed", "NETWORK_ERROR", { event: "changed" });
      const httpError = makeError("HTTP 404", "SERVER_ERROR", { request: "https://wrong-rpc.example" });
      for (const error of [
        new SyntaxError("invalid RewardManager artifact"),
        changedNetwork,
        httpError,
        { code: "INVALID_ARGUMENT" },
        { code: "BAD_DATA" },
        { code: "CALL_EXCEPTION" },
        { code: "EPERM", syscall: "open" },
      ]) {
        expect(isRewardManagerTransportError(error)).to.eq(false);
      }
    });
  });

  // Whoever runs the calculation must be able to see the outcome without opening the report file, so the summary is
  // printed for both outcomes and is the last thing the reward epoch emits.
  describe("end of run summary", () => {
    function capture(
      reconciliation: FccReconciliation,
      includeOnChainTotal = true
    ): { lines: string[]; errors: string[] } {
      const lines: string[] = [];
      const errors: string[] = [];
      const logger: ILogger = {
        log: (m: string) => lines.push(m),
        error: (m: string) => {
          lines.push(m);
          errors.push(m);
        },
        warn: (m: string) => lines.push(m),
      };
      logFccReconciliationSummary(
        {
          ...reconciliation,
          totalClaimsWei: 0n,
          rewardManagerTotalRewardsWei: includeOnChainTotal ? 0n : undefined,
          rewardManagerTotalInflationRewardsWei: includeOnChainTotal ? 0n : undefined,
        },
        "report.json",
        logger
      );
      return { lines, errors };
    }

    it("reports every check as passed when the accounting balances", () => {
      const calculationFolder = writeFixture({
        [START_VOTING_ROUND_ID]: { tee: [{ fee: 600n }], fdc2: [{ fee: 400n }] },
      });
      const { lines, errors } = capture(
        computeFccReconciliation(REWARD_EPOCH_ID, START_VOTING_ROUND_ID, END_VOTING_ROUND_ID, calculationFolder)
      );
      const summary = lines.join("\n");
      expect(summary).to.contain("ALL CHECKS PASSED");
      expect(summary).to.contain("[PASS] observed FCC fees are fully claimed");
      expect(summary).to.contain("[PASS] every FDC2 request is paired with a TEE instruction");
      expect(summary).to.contain("[PASS] every voting round carries FCC data");
      // boundary exclusions are informational, never a pass/fail check
      expect(summary).to.contain("[INFO] boundary events excluded");
      expect(summary).to.not.contain("[FAIL]");
      // a clean run must not be reported through the error channel
      expect(errors).to.deep.eq([]);
    });

    it("does not claim that every check passed when the on-chain comparison was skipped", () => {
      const calculationFolder = writeFixture({});
      const { lines, errors } = capture(
        computeFccReconciliation(REWARD_EPOCH_ID, START_VOTING_ROUND_ID, END_VOTING_ROUND_ID, calculationFolder),
        false
      );
      const summary = lines.join("\n");
      expect(summary).to.contain("ARTIFACT CHECKS PASSED - ON-CHAIN CHECK SKIPPED");
      expect(summary).to.not.contain("ALL CHECKS PASSED");
      expect(summary).to.contain("[WARN] RewardManager totals unavailable");
      expect(summary).to.contain("RPC transport error");
      expect(errors).to.deep.eq([]);
    });

    it("names the failing check and reports it through the error channel", () => {
      const calculationFolder = writeFixture({
        [START_VOTING_ROUND_ID]: { tee: [{ fee: 600n }], claimedTee: 500n },
      });
      const reconciliation = computeFccReconciliation(
        REWARD_EPOCH_ID,
        START_VOTING_ROUND_ID,
        END_VOTING_ROUND_ID,
        calculationFolder
      );
      const { lines, errors } = capture(reconciliation);
      const summary = lines.join("\n");
      expect(summary).to.contain("1 CHECK(S) FAILED");
      expect(summary).to.contain("[FAIL] observed FCC fees are fully claimed");
      expect(errors.length).to.be.greaterThan(0);
      // the summary is printed, and only then does the run fail
      expect(() => assertFccReconciliation(reconciliation)).to.throw("FCC reconciliation failed");
    });
  });

  it("balances trivially for a reward epoch with no FCC activity", () => {
    const calculationFolder = writeFixture({});
    const reconciliation = computeFccReconciliation(
      REWARD_EPOCH_ID,
      START_VOTING_ROUND_ID,
      END_VOTING_ROUND_ID,
      calculationFolder
    );
    expect(reconciliation.observedFeesWei).to.eq(0n);
    expect(reconciliation.claimedFeesWei).to.eq(0n);
    expect(reconciliation.residualWei).to.eq(0n);
    expect(reconciliation.votingRoundsWithFccActivity).to.eq(0);
    expect(() => assertFccReconciliation(reconciliation)).to.not.throw();
  });
});
