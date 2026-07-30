import { expect } from "chai";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path/posix";
import { bigIntReplacer } from "../../../libs/ftso-core/src/utils/big-number-serialization";
import { BURN_ADDRESS, CALCULATIONS_FOLDER, FCC_FEES_ADDRESS } from "../../../libs/fsp-rewards/src/constants";
import { ILogger } from "../../../libs/ftso-core/src/utils/ILogger";
import {
  assertFccReconciliation,
  computeFccReconciliation,
  FccReconciliation,
  logFccReconciliationSummary,
} from "../../../libs/fsp-rewards/src/reward-calculation/fcc/fcc-reconciliation";
import { RewardTypePrefix } from "../../../libs/fsp-rewards/src/reward-calculation/RewardTypePrefix";
import { ClaimType, IPartialRewardClaim, IRewardClaim } from "../../../libs/fsp-rewards/src/utils/RewardClaim";
import { CLAIMS_FILE, REWARD_CALCULATION_DATA_FILE } from "../../../libs/fsp-rewards/src/utils/stat-info/constants";
import { serializeRewardDistributionData } from "../../../libs/fsp-rewards/src/utils/stat-info/reward-distribution-data";
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
  // FCC claim amounts written to claims.json; defaults to the observed sums
  claimedTee?: bigint;
  claimedFdc2?: bigint;
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

    writeFileSync(
      path.join(votingRoundFolder, REWARD_CALCULATION_DATA_FILE),
      JSON.stringify(
        {
          fccData: {
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
          },
        },
        bigIntReplacer
      )
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
    writeFileSync(path.join(votingRoundFolder, CLAIMS_FILE), JSON.stringify(claims, bigIntReplacer));
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
    expect(reconciliation.eventsWithForeignRewardEpochId).to.eq(0);
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

  // Every FDC2 request emits both events in one transaction, so a missing counterpart means lost events.
  it("fails hard when an FDC2 request has no paired TeeInstructionsSent event", () => {
    const calculationFolder = writeFixture({
      [START_VOTING_ROUND_ID]: {
        tee: [{ fee: 600n, instructionId: INSTRUCTION_ID_A }],
        fdc2: [{ fee: 400n, instructionId: INSTRUCTION_ID_B }],
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

  // Counted so a boundary attribution split can be observed on real data before the check is made fatal.
  it("counts events whose own reward epoch id differs from the epoch they were bucketed into", () => {
    const calculationFolder = writeFixture({
      [START_VOTING_ROUND_ID]: { tee: [{ fee: 600n, rewardEpochId: REWARD_EPOCH_ID - 1 }] },
    });
    const reconciliation = computeFccReconciliation(
      REWARD_EPOCH_ID,
      START_VOTING_ROUND_ID,
      END_VOTING_ROUND_ID,
      calculationFolder
    );
    expect(reconciliation.eventsWithForeignRewardEpochId).to.eq(1);
    // reported, not fatal
    expect(() => assertFccReconciliation(reconciliation)).to.not.throw();
  });

  // Whoever runs the calculation must be able to see the outcome without opening the report file, so the summary is
  // printed for both outcomes and is the last thing the reward epoch emits.
  describe("end of run summary", () => {
    function capture(reconciliation: FccReconciliation): { lines: string[]; errors: string[] } {
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
      logFccReconciliationSummary({ ...reconciliation, totalClaimsWei: 0n }, "report.json", logger);
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
      expect(summary).to.contain("[PASS] reward epoch attribution");
      expect(summary).to.not.contain("[FAIL]");
      // a clean run must not be reported through the error channel
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
