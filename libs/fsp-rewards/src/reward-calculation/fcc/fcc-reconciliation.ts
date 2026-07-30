import { writeFileSync } from "fs";
import path from "path/posix";
import type { networks } from "../../../../contracts/src/constants";
import { bigIntReplacer } from "../../../../ftso-core/src/utils/big-number-serialization";
import { ILogger } from "../../../../ftso-core/src/utils/ILogger";
import { BURN_ADDRESS, CALCULATIONS_FOLDER, FCC_FEES_ADDRESS, FIRE_POOL_ADDRESS, isFccActive } from "../../constants";
import { ClaimType } from "../../utils/RewardClaim";
import { FCC_RECONCILIATION_FILE } from "../../utils/stat-info/constants";
import { deserializePartialClaimsForVotingRoundId } from "../../utils/stat-info/partial-claims";
import { deserializeDataForRewardCalculation } from "../../utils/stat-info/reward-calculation-data";
import { deserializeRewardDistributionData } from "../../utils/stat-info/reward-distribution-data";
import { deserializeRewardEpochInfo, RewardEpochInfo } from "../../utils/stat-info/reward-epoch-info";
import { RewardTypePrefix } from "../RewardTypePrefix";
import { getRewardEpochTotals } from "./reward-manager-totals";

/**
 * Exact inflation represented by claims this calculator produces: FTSO scaling, Fast Updates, and FDC.
 *
 * All three inputs are required for the Coston2 exception. Treating an absent collector as zero would enlarge the
 * exclusion and hide the very missing-claims failure the independent RewardManager check is meant to catch.
 */
export function calculatorCoveredInflationRewardsWei(rewardEpochInfo: RewardEpochInfo): bigint {
  const ftsoInflationOffers = rewardEpochInfo.rewardOffers?.inflationOffers;
  if (ftsoInflationOffers === undefined || ftsoInflationOffers.length === 0) {
    throw new Error("Coston2 reconciliation requires the FTSO inflation reward offers");
  }
  if (rewardEpochInfo.fuInflationRewardsOffered === undefined) {
    throw new Error("Coston2 reconciliation requires the Fast Updates inflation reward offer");
  }
  if (rewardEpochInfo.fdcInflationRewardsOffered === undefined) {
    throw new Error("Coston2 reconciliation requires the FDC inflation reward offer");
  }
  return (
    ftsoInflationOffers.reduce((total, offer) => total + offer.amount, 0n) +
    rewardEpochInfo.fuInflationRewardsOffered.amount +
    rewardEpochInfo.fdcInflationRewardsOffered.amount
  );
}

/**
 * Coston2's exact inflation allocation for which this calculator produces no staking claims.
 *
 * Coston2 configures ValidatorRewardOffersManager for 3000 BIPS, but each receiver rounds its own offer before the
 * RewardManager aggregates them. Multiplying the aggregate total by 30% can therefore be wrong by one wei. The
 * exact validator remainder is the on-chain inflation total minus the three serialized, required inflation offers
 * whose claims this calculator does produce.
 */
export function coston2ValidatorInflationRewardsWei(
  totalInflationRewardsWei: bigint,
  calculatorCoveredInflationWei: bigint
): bigint {
  if (calculatorCoveredInflationWei > totalInflationRewardsWei) {
    throw new Error(
      `Coston2 calculator-covered inflation ${calculatorCoveredInflationWei} wei exceeds the on-chain total ` +
        `${totalInflationRewardsWei} wei`
    );
  }
  const validatorInflationWei = totalInflationRewardsWei - calculatorCoveredInflationWei;
  return validatorInflationWei;
}

/** Returns the only network-specific RewardManager exclusion supported by this calculator. */
export function rewardManagerExcludedRewardsWei(
  network: networks,
  totalInflationRewardsWei: bigint,
  calculatorCoveredInflationWei?: bigint
): bigint {
  if (network !== "coston2") {
    return 0n;
  }
  if (calculatorCoveredInflationWei === undefined) {
    throw new Error("Coston2 reconciliation requires the calculator-covered inflation total");
  }
  return coston2ValidatorInflationRewardsWei(totalInflationRewardsWei, calculatorCoveredInflationWei);
}

/**
 * Result of reconciling the FCC fees of a reward epoch.
 *
 * Amounts are in wei. The FCC part is exact by construction: the two fee events correspond one to one with the
 * `receiveRewards` calls that credit the funds, so there is no legitimate rounding source and any non-zero
 * residual is a real defect.
 */
export interface FccReconciliation {
  rewardEpochId: number;
  startVotingRoundId: number;
  endVotingRoundId: number;
  votingRoundsWithFccActivity: number;

  // Observed on chain, from the FCC fee events.
  teeFeesWei: bigint;
  fdc2FeesWei: bigint;
  observedFeesWei: bigint;

  // Produced by the claim calculation.
  claimedTeeFeesWei: bigint;
  claimedFdc2FeesWei: bigint;
  claimedFeesWei: bigint;

  // observedFeesWei - claimedFeesWei. Must be zero.
  residualWei: bigint;

  // Amount the final reward distribution assigns to FCC_FEES_ADDRESS as a DIRECT claim.
  finalDirectClaimToFccAddressWei: bigint;

  /**
   * Events seen in the funding window but credited to a neighbouring reward epoch, and so excluded.
   *
   * Expected, not anomalous: the window is bounded by the RewardEpochStarted events and deliberately overshoots at
   * both ends so nothing is missed, and the reward epoch id each event carries is what narrows it. Reported so that
   * boundary activity is visible; never a failure condition.
   */
  eventsExcludedByRewardEpochId: number;

  /**
   * FDC2 requests with no TeeInstructionsSent carrying the same instructionId anywhere in the funding window.
   *
   * Every FDC2 request forwards its remainder into FlareTeeManager in the same transaction, so the pair is always
   * emitted together. The FDC2 event carries no reward epoch id of its own, so without its pair the fee cannot be
   * attributed to any epoch at all: this is a hard failure, not merely an integrity signal.
   */
  unpairedFdc2Requests: number;

  /**
   * Voting rounds inside this epoch whose serialized data carries no fccData at all.
   *
   * Their claims were computed without FCC, so both sides of the balance read zero for them and the epoch would
   * appear to reconcile while fees sat unclaimed. A hard failure.
   */
  roundsWithoutFccData: number;

  /**
   * Untagged DIRECT claims to FCC_FEES_ADDRESS found in the serialized partial claims.
   *
   * `RewardClaim.merge` rebuilds claims as `{beneficiary, amount, claimType}` only, dropping `rewardTypeTag`. If
   * merged claims are serialized, the FCC tag sums read zero and the epoch looks as though its fees were lost. The
   * production path serializes unmerged, but `merge` defaults to true, so this distinguishes the two.
   */
  untaggedDirectClaimsToFccAddress: number;
}

/**
 * Reconciles the FCC fees of a reward epoch against the claims produced for it.
 *
 * Reads only the artifacts the calculation already produced, so it needs no node and no extra indexer queries.
 */
export function computeFccReconciliation(
  rewardEpochId: number,
  startVotingRoundId: number,
  endVotingRoundId: number,
  calculationFolder = CALCULATIONS_FOLDER()
): FccReconciliation {
  let teeFeesWei = 0n;
  let fdc2FeesWei = 0n;
  let claimedTeeFeesWei = 0n;
  let claimedFdc2FeesWei = 0n;
  let eventsExcludedByRewardEpochId = 0;
  let unpairedFdc2Requests = 0;
  let votingRoundsWithFccActivity = 0;
  let roundsWithoutFccData = 0;
  let untaggedDirectClaimsToFccAddress = 0;

  for (let votingRoundId = startVotingRoundId; votingRoundId <= endVotingRoundId; votingRoundId++) {
    const data = deserializeDataForRewardCalculation(rewardEpochId, votingRoundId, false, calculationFolder);
    const fccData = data.fccData;
    if (fccData === undefined) {
      // The round was serialized before FCC accounting existed, or by a run that had it inactive. Its claims were
      // computed without FCC, so the epoch cannot be reconciled from these artifacts.
      roundsWithoutFccData++;
    } else {
      for (const event of fccData.teeInstructions) {
        teeFeesWei += event.fee;
      }
      for (const event of fccData.fdc2AttestationRequests) {
        fdc2FeesWei += event.fee;
      }
      eventsExcludedByRewardEpochId += fccData.eventsExcludedByRewardEpochId;
      unpairedFdc2Requests += fccData.unpairedFdc2Requests;
      if (fccData.teeInstructions.length > 0 || fccData.fdc2AttestationRequests.length > 0) {
        votingRoundsWithFccActivity++;
      }
    }

    for (const claim of deserializePartialClaimsForVotingRoundId(rewardEpochId, votingRoundId, calculationFolder)) {
      if (claim.rewardTypeTag === String(RewardTypePrefix.FCC_TEE_FEES)) {
        claimedTeeFeesWei += claim.amount;
      }
      if (claim.rewardTypeTag === String(RewardTypePrefix.FCC_FDC2_FEES)) {
        claimedFdc2FeesWei += claim.amount;
      }
      // RewardClaim.merge rebuilds claims as {beneficiary, amount, claimType} and drops every tag, so merged claims
      // reaching disk make both sums above read zero. Counted so that tag erasure is not misreported as lost funds.
      if (
        claim.rewardTypeTag === undefined &&
        claim.claimType === ClaimType.DIRECT &&
        claim.beneficiary.toLowerCase() === FCC_FEES_ADDRESS.toLowerCase()
      ) {
        untaggedDirectClaimsToFccAddress++;
      }
    }
  }

  const observedFeesWei = teeFeesWei + fdc2FeesWei;
  const claimedFeesWei = claimedTeeFeesWei + claimedFdc2FeesWei;

  let finalDirectClaimToFccAddressWei = 0n;
  const distributionData = deserializeRewardDistributionData(rewardEpochId, false, calculationFolder);
  for (const claimWithProof of distributionData.rewardClaims) {
    const claim = claimWithProof.body;
    if (claim.claimType === ClaimType.DIRECT && claim.beneficiary.toLowerCase() === FCC_FEES_ADDRESS.toLowerCase()) {
      finalDirectClaimToFccAddressWei += claim.amount;
    }
  }

  return {
    rewardEpochId,
    startVotingRoundId,
    endVotingRoundId,
    votingRoundsWithFccActivity,
    teeFeesWei,
    fdc2FeesWei,
    observedFeesWei,
    claimedTeeFeesWei,
    claimedFdc2FeesWei,
    claimedFeesWei,
    residualWei: observedFeesWei - claimedFeesWei,
    finalDirectClaimToFccAddressWei,
    eventsExcludedByRewardEpochId,
    unpairedFdc2Requests,
    roundsWithoutFccData,
    untaggedDirectClaimsToFccAddress,
  };
}

/**
 * Whether `FCC_FEES_ADDRESS` receives FCC fees and nothing else.
 *
 * On the test networks it is the dead address, which is also the burn and FIRE pool address, so the merged DIRECT
 * claim for it aggregates far more than FCC fees. On the production networks it is a dedicated address.
 */
function isFccFeesAddressExclusive(): boolean {
  const fccFeesAddress = FCC_FEES_ADDRESS.toLowerCase();
  return fccFeesAddress !== BURN_ADDRESS.toLowerCase() && fccFeesAddress !== FIRE_POOL_ADDRESS.toLowerCase();
}

/**
 * Outcome of one reconciliation check, for the end-of-run summary.
 */
export interface FccCheck {
  /** Short label naming what was checked. */
  name: string;
  passed: boolean;
  /** Why it failed, or what the passing value was. */
  detail: string;
}

/**
 * Evaluates the hard FCC checks and returns one entry per check, passing or failing.
 *
 * No tolerance on any of them: the FCC fee events map one to one onto the `receiveRewards` credits, so there is
 * nothing that can legitimately round away. A failure means funds on RewardManager are not covered by the claims.
 */
export function fccReconciliationChecks(reconciliation: FccReconciliation): FccCheck[] {
  const checks: FccCheck[] = [];

  checks.push({
    name: "observed FCC fees are fully claimed",
    passed: reconciliation.residualWei === 0n,
    detail:
      reconciliation.residualWei === 0n
        ? `residual 0 wei`
        : `observed fees ${reconciliation.observedFeesWei} wei but claims total ${reconciliation.claimedFeesWei} ` +
          `wei (residual ${reconciliation.residualWei} wei). ` +
          (reconciliation.claimedFeesWei === 0n && reconciliation.untaggedDirectClaimsToFccAddress > 0
            ? `The claims were serialized after RewardClaim.merge, which drops rewardTypeTag: ` +
              `${reconciliation.untaggedDirectClaimsToFccAddress} untagged DIRECT claims to ${FCC_FEES_ADDRESS} ` +
              `are present. The fees are not lost, the tags the reconciliation counts by are. Serialize partial ` +
              `claims unmerged.`
            : `Funds on RewardManager would not be fully claimed.`),
  });

  // The FCC fees must survive into the final distribution. Only a lower bound can be asserted when FCC_FEES_ADDRESS
  // is shared with the burn or FIRE pool address, as it is on the test networks: the merged DIRECT claim for that
  // address then also carries every burned reward, so equality would never hold. Where the address is exclusive to
  // FCC, which is the case on the production networks, the amount must match exactly.
  const exclusive = isFccFeesAddressExclusive();
  const finalClaimShort = reconciliation.finalDirectClaimToFccAddressWei < reconciliation.observedFeesWei;
  const finalClaimMismatched =
    exclusive && reconciliation.finalDirectClaimToFccAddressWei !== reconciliation.observedFeesWei;
  checks.push({
    name: exclusive
      ? "final distribution assigns exactly the FCC fees"
      : "final distribution carries at least the FCC fees",
    passed: !finalClaimShort && !finalClaimMismatched,
    detail: finalClaimShort
      ? `the final reward distribution assigns only ${reconciliation.finalDirectClaimToFccAddressWei} wei to ` +
        `${FCC_FEES_ADDRESS}, less than the ${reconciliation.observedFeesWei} wei of FCC fees observed on chain, ` +
        `so FCC fees were lost before the Merkle tree was built.`
      : finalClaimMismatched
        ? `the final reward distribution assigns ${reconciliation.finalDirectClaimToFccAddressWei} wei to ` +
          `${FCC_FEES_ADDRESS}, which is used only for FCC fees, but ${reconciliation.observedFeesWei} wei of ` +
          `FCC fees were observed on chain.`
        : `${reconciliation.finalDirectClaimToFccAddressWei} wei assigned to ${FCC_FEES_ADDRESS}` +
          (exclusive ? "" : " (shared with the burn and FIRE pool address, so a lower bound)"),
  });

  checks.push({
    name: "every FDC2 request is paired with a TEE instruction",
    passed: reconciliation.unpairedFdc2Requests === 0,
    detail:
      reconciliation.unpairedFdc2Requests === 0
        ? `0 unpaired`
        : `${reconciliation.unpairedFdc2Requests} FDC2 attestation requests have no paired TeeInstructionsSent ` +
          `event. Every FDC2 request emits both in the same transaction, and the FDC2 event carries no reward ` +
          `epoch id of its own, so without its pair the fee cannot be attributed to any epoch. Events are missing ` +
          `from the indexer.`,
  });

  // Without this the epoch would balance at zero for those rounds while their fees sat unclaimed, which is the one
  // failure the observed-versus-claimed comparison cannot see: both of its sides come from these same artifacts.
  checks.push({
    name: "every voting round carries FCC data",
    passed: reconciliation.roundsWithoutFccData === 0,
    detail:
      reconciliation.roundsWithoutFccData === 0
        ? `all rounds present`
        : `${reconciliation.roundsWithoutFccData} voting rounds have no fccData, so their claims were computed ` +
          `without FCC. Recalculate the epoch in full rather than incrementally: a mid-epoch deploy leaves rounds ` +
          `serialized by the previous version behind.`,
  });

  return checks;
}

/**
 * The independent invariant the whole reconciliation exists for: every wei this calculator is responsible for in
 * RewardManager is covered by a claim.
 *
 * `epochTotalRewards` is the sum of every `receiveRewards` credit for the epoch, inflation and fees alike, and the
 * final reward distribution is what will be claimed against it. Anything the calculation fails to account for
 * simply stays on the contract, unclaimable and unnoticed, which is exactly the failure no other check can see.
 *
 * Holds exactly on both production networks — Flare and Songbird reward epoch 418 each reconcile to the wei. On
 * Coston2, the known 30% ValidatorRewardOffersManager allocation is excluded explicitly because that network does
 * not produce its staking claims; every other reward source remains strict.
 * Returns undefined when a transport failure prevented the RewardManager totals from being read, since an
 * unreachable node is an environment problem rather than an accounting one.
 */
export function fundsFullyClaimedCheck(report: FccReconciliationReport): FccCheck | undefined {
  if (report.rewardManagerTotalRewardsWei === undefined) {
    return undefined;
  }
  const excludedRewardsWei = report.rewardManagerExcludedRewardsWei ?? 0n;
  const claimableRewardsWei = report.rewardManagerTotalRewardsWei - excludedRewardsWei;
  const residual = report.totalClaimsWei - claimableRewardsWei;
  const exclusionDetail =
    excludedRewardsWei === 0n
      ? ""
      : ` after excluding ${excludedRewardsWei} wei of exact Coston2 validator inflation that has no staking claims`;
  return {
    name: "all claimable RewardManager funds are covered by claims",
    passed: claimableRewardsWei >= 0n && residual === 0n,
    detail:
      claimableRewardsWei < 0n
        ? `the configured exclusion ${excludedRewardsWei} wei exceeds the ${report.rewardManagerTotalRewardsWei} ` +
          `wei held for the epoch`
        : residual === 0n
          ? `${report.totalClaimsWei} wei claimed, matching ${claimableRewardsWei} wei of claimable funds${exclusionDetail}`
          : residual < 0n
            ? `${report.totalClaimsWei} wei claimed of ${claimableRewardsWei} wei claimable from ` +
              `${report.rewardManagerTotalRewardsWei} wei held${exclusionDetail}, leaving ${-residual} wei unclaimed. ` +
              `This spans every reward source, so the cause need not be FCC.`
            : `${report.totalClaimsWei} wei claimed but only ${claimableRewardsWei} wei is claimable from ` +
              `${report.rewardManagerTotalRewardsWei} wei held${exclusionDetail}; claims exceed claimable funds by ` +
              `${residual} wei.`,
  };
}

/**
 * Every check for the epoch, FCC specific and overall, evaluated once so the printed summary and the thrown error
 * cannot disagree.
 */
export function allReconciliationChecks(report: FccReconciliationReport): FccCheck[] {
  const checks = fccReconciliationChecks(report);
  const funds = fundsFullyClaimedCheck(report);
  if (funds !== undefined) {
    checks.push(funds);
  }
  return checks;
}

/**
 * Throws when any hard FCC check fails.
 */
export function assertFccReconciliation(reconciliation: FccReconciliation): void {
  const failures = fccReconciliationChecks(reconciliation).filter((check) => !check.passed);
  if (failures.length > 0) {
    throw new Error(
      `FCC reconciliation failed for reward epoch ${reconciliation.rewardEpochId}: ` +
        failures.map((failure) => failure.detail).join(" ")
    );
  }
}

/**
 * Reconciliation report written to disk for a reward epoch.
 */
export interface FccReconciliationReport extends FccReconciliation {
  /** Sum of every claim in the final reward distribution. */
  totalClaimsWei: bigint;
  /**
   * `RewardManager.getRewardEpochTotals(rewardEpochId).totalRewardsWei`, read over RPC.
   * Undefined when an RPC transport failure prevented the read, which is reported but not treated as an accounting
   * failure. Configuration, ABI, decoding, and contract-call errors fail finalization instead.
   */
  rewardManagerTotalRewardsWei?: bigint;
  /** `RewardManager.getRewardEpochTotals(rewardEpochId).totalInflationRewardsWei`, read by the same RPC call. */
  rewardManagerTotalInflationRewardsWei?: bigint;
  /** Exact sum of the serialized FTSO, Fast Updates, and FDC inflation offers, present only on Coston2. */
  calculatorCoveredInflationRewardsWei?: bigint;
  /**
   * Rewards deliberately outside this calculator's scope.
   *
   * Present only on Coston2, where ValidatorRewardOffersManager receives 30% of inflation but the network does not
   * produce staking claims. This is the on-chain inflation total minus the exact covered inflation offers, preserving
   * the contracts' per-receiver rounding; it is not inferred from the claims discrepancy.
   */
  rewardManagerExcludedRewardsWei?: bigint;
  /** totalClaimsWei - (rewardManagerTotalRewardsWei - rewardManagerExcludedRewardsWei). */
  rewardManagerResidualWei?: bigint;
}

/**
 * Reconciles the FCC fees of a reward epoch, writes the report and fails hard if the FCC accounting does not balance.
 *
 * Also compares the sum of all claims against the claimable funds RewardManager holds for the epoch. The comparison
 * is fatal whenever the RPC total is available. Coston2's known validator-inflation allocation is excluded
 * explicitly; no generic tolerance is applied to any network.
 *
 * No-op for reward epochs where FCC accounting is not active.
 */
export async function runFccReconciliation(
  rewardEpochId: number,
  startVotingRoundId: number,
  endVotingRoundId: number,
  logger: ILogger = console,
  calculationFolder = CALCULATIONS_FOLDER()
): Promise<FccReconciliationReport | undefined> {
  if (!isFccActive(rewardEpochId)) {
    return undefined;
  }
  const reconciliation = computeFccReconciliation(
    rewardEpochId,
    startVotingRoundId,
    endVotingRoundId,
    calculationFolder
  );

  const distributionData = deserializeRewardDistributionData(rewardEpochId, false, calculationFolder);
  const totalClaimsWei = distributionData.rewardClaims.reduce((total, claim) => total + claim.body.amount, 0n);

  const report: FccReconciliationReport = { ...reconciliation, totalClaimsWei };

  // Both outcomes are surfaced by the summary below, so nothing is logged here.
  const totals = await getRewardEpochTotals(rewardEpochId);
  if (totals !== undefined) {
    report.rewardManagerTotalRewardsWei = totals.totalRewardsWei;
    report.rewardManagerTotalInflationRewardsWei = totals.totalInflationRewardsWei;
    const network = process.env.NETWORK as networks;
    if (network === "coston2") {
      report.calculatorCoveredInflationRewardsWei = calculatorCoveredInflationRewardsWei(
        deserializeRewardEpochInfo(rewardEpochId, false, calculationFolder)
      );
    }
    const excludedRewardsWei = rewardManagerExcludedRewardsWei(
      network,
      totals.totalInflationRewardsWei,
      report.calculatorCoveredInflationRewardsWei
    );
    if (excludedRewardsWei > 0n) {
      report.rewardManagerExcludedRewardsWei = excludedRewardsWei;
    }
    report.rewardManagerResidualWei =
      totalClaimsWei - (totals.totalRewardsWei - (report.rewardManagerExcludedRewardsWei ?? 0n));
  }

  const reportPath = path.join(calculationFolder, `${rewardEpochId}`, FCC_RECONCILIATION_FILE);
  writeFileSync(reportPath, JSON.stringify(report, bigIntReplacer, 2));

  // Evaluated once and shared, so the printed summary and the thrown error are the same verdict.
  const checks = allReconciliationChecks(report);
  logFccReconciliationSummary(report, reportPath, logger, checks);

  // Thrown after the summary, so that whoever ran the calculation sees which check failed rather than a stack trace.
  const failures = checks.filter((check) => !check.passed);
  if (failures.length > 0) {
    throw new Error(
      `Reward epoch ${rewardEpochId} reconciliation failed: ` + failures.map((failure) => failure.detail).join(" ")
    );
  }

  return report;
}

/** Renders wei as a whole-token decimal, purely for readability alongside the exact wei value. */
function formatWeiAsTokens(wei: bigint): string {
  const negative = wei < 0n;
  const absolute = negative ? -wei : wei;
  const whole = (absolute / 10n ** 18n).toString();
  const fraction = (absolute % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? "." + fraction : ""}`;
}

/**
 * Prints the end-of-run FCC accounting summary.
 *
 * This is the last thing the reward calculation prints for a reward epoch, and it is printed whether the checks
 * pass or fail, so that whoever runs the calculation can see the outcome without reading the report file or
 * scrolling back through the per-voting-round log. Failures are printed via `error` so they stand out.
 */
export function logFccReconciliationSummary(
  report: FccReconciliationReport,
  reportPath: string,
  logger: ILogger = console,
  checks: FccCheck[] = allReconciliationChecks(report)
): void {
  const failed = checks.filter((check) => !check.passed);
  const onChainCheckSkipped = report.rewardManagerTotalRewardsWei === undefined;
  const rule = "=".repeat(112);
  const emit = (line: string): void => {
    if (failed.length > 0) {
      logger.error(line);
    } else {
      logger.log(line);
    }
  };

  emit(rule);
  emit(
    `FCC FEE ACCOUNTING - reward epoch ${report.rewardEpochId} - ` +
      (failed.length > 0
        ? `${failed.length} CHECK(S) FAILED`
        : onChainCheckSkipped
          ? "ARTIFACT CHECKS PASSED - ON-CHAIN CHECK SKIPPED"
          : "ALL CHECKS PASSED")
  );
  emit(rule);
  emit(
    `  TEE instruction fees   ${report.teeFeesWei.toString().padStart(28)} wei  ${formatWeiAsTokens(report.teeFeesWei)}`
  );
  emit(
    `  FDC2 request fees      ${report.fdc2FeesWei.toString().padStart(28)} wei  ${formatWeiAsTokens(report.fdc2FeesWei)}`
  );
  emit(
    `  observed FCC fees      ${report.observedFeesWei.toString().padStart(28)} wei  ${formatWeiAsTokens(report.observedFeesWei)}`
  );
  emit(
    `  claimed as FCC fees    ${report.claimedFeesWei.toString().padStart(28)} wei  ${formatWeiAsTokens(report.claimedFeesWei)}`
  );
  emit(`  voting rounds with FCC activity: ${report.votingRoundsWithFccActivity}`);
  emit(`  beneficiary: ${FCC_FEES_ADDRESS}`);
  emit("-".repeat(112));
  for (const check of checks) {
    emit(`  [${check.passed ? "PASS" : "FAIL"}] ${check.name}: ${check.detail}`);
  }

  // Informational: the funding window is bounded by the RewardEpochStarted events and overshoots both ends on
  // purpose, so events belonging to a neighbouring epoch are expected here and are simply filtered out.
  emit(
    `  [INFO] boundary events excluded: ${report.eventsExcludedByRewardEpochId} event(s) inside the funding ` +
      `window carried a neighbouring reward epoch id and were attributed there instead`
  );
  if (report.rewardManagerTotalRewardsWei === undefined) {
    emit(`  [WARN] RewardManager totals unavailable: on-chain comparison not run (RPC transport error)`);
  }
  emit(`  report: ${reportPath}`);
  emit(rule);
}
