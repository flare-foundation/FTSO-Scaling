import { writeFileSync } from "fs";
import path from "path/posix";
import { bigIntReplacer } from "../../../../ftso-core/src/utils/big-number-serialization";
import { ILogger } from "../../../../ftso-core/src/utils/ILogger";
import { BURN_ADDRESS, CALCULATIONS_FOLDER, FCC_FEES_ADDRESS, FIRE_POOL_ADDRESS, isFccActive } from "../../constants";
import { ClaimType } from "../../utils/RewardClaim";
import { FCC_RECONCILIATION_FILE } from "../../utils/stat-info/constants";
import { deserializePartialClaimsForVotingRoundId } from "../../utils/stat-info/partial-claims";
import { deserializeDataForRewardCalculation } from "../../utils/stat-info/reward-calculation-data";
import { deserializeRewardDistributionData } from "../../utils/stat-info/reward-distribution-data";
import { RewardTypePrefix } from "../RewardTypePrefix";
import { getRewardEpochTotals } from "./reward-manager-totals";

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
   * TeeInstructionsSent events whose own rewardEpochId differs from the epoch they were bucketed into.
   *
   * The event carries the very reward epoch id that RewardManager credited, so a non-zero count means funds were
   * credited to one epoch while being claimed in another. Reported rather than fatal for now: the voting round
   * boundaries and the on-chain epoch switch are expected to coincide, and this counter is what proves it on real
   * data before the check is promoted to a hard failure.
   */
  eventsWithForeignRewardEpochId: number;

  /**
   * FDC2 requests with no TeeInstructionsSent carrying the same instructionId in the same voting round.
   *
   * Every FDC2 request forwards its remainder into FlareTeeManager in the same transaction, so the pair is always
   * emitted together. A missing counterpart means events were lost between the chain and the indexer.
   */
  unpairedFdc2Requests: number;
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
  let eventsWithForeignRewardEpochId = 0;
  let unpairedFdc2Requests = 0;
  let votingRoundsWithFccActivity = 0;

  for (let votingRoundId = startVotingRoundId; votingRoundId <= endVotingRoundId; votingRoundId++) {
    const data = deserializeDataForRewardCalculation(rewardEpochId, votingRoundId, false, calculationFolder);
    const fccData = data?.fccData;
    if (fccData) {
      const teeInstructionIds = new Set(fccData.teeInstructions.map((event) => event.instructionId));
      for (const event of fccData.teeInstructions) {
        teeFeesWei += event.fee;
        if (event.rewardEpochId !== rewardEpochId) {
          eventsWithForeignRewardEpochId++;
        }
      }
      for (const event of fccData.fdc2AttestationRequests) {
        fdc2FeesWei += event.fee;
        if (!teeInstructionIds.has(event.instructionId)) {
          unpairedFdc2Requests++;
        }
      }
      if (fccData.teeInstructions.length > 0 || fccData.fdc2AttestationRequests.length > 0) {
        votingRoundsWithFccActivity++;
      }
    }

    for (const claim of deserializePartialClaimsForVotingRoundId(rewardEpochId, votingRoundId, calculationFolder)) {
      if (claim.rewardTypeTag === RewardTypePrefix.FCC_TEE_FEES) {
        claimedTeeFeesWei += claim.amount;
      }
      if (claim.rewardTypeTag === RewardTypePrefix.FCC_FDC2_FEES) {
        claimedFdc2FeesWei += claim.amount;
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
    eventsWithForeignRewardEpochId,
    unpairedFdc2Requests,
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
 * Throws when the FCC accounting of a reward epoch does not balance.
 *
 * No tolerance: the FCC fee events map one to one onto the `receiveRewards` credits, so there is nothing that can
 * legitimately round away. A mismatch means funds on RewardManager are not covered by the claims.
 */
export function assertFccReconciliation(reconciliation: FccReconciliation): void {
  if (reconciliation.residualWei !== 0n) {
    throw new Error(
      `FCC reconciliation failed for reward epoch ${reconciliation.rewardEpochId}: observed fees ` +
        `${reconciliation.observedFeesWei} wei but claims total ${reconciliation.claimedFeesWei} wei ` +
        `(residual ${reconciliation.residualWei} wei). Funds on RewardManager would not be fully claimed.`
    );
  }
  // The FCC fees must survive into the final distribution. Only a lower bound can be asserted when FCC_FEES_ADDRESS
  // is shared with the burn or FIRE pool address, as it is on the test networks: the merged DIRECT claim for that
  // address then also carries every burned reward, so equality would never hold. Where the address is exclusive to
  // FCC, which is the case on the production networks, the amount must match exactly.
  if (reconciliation.finalDirectClaimToFccAddressWei < reconciliation.observedFeesWei) {
    throw new Error(
      `FCC reconciliation failed for reward epoch ${reconciliation.rewardEpochId}: the final reward distribution ` +
        `assigns only ${reconciliation.finalDirectClaimToFccAddressWei} wei to ${FCC_FEES_ADDRESS}, less than the ` +
        `${reconciliation.observedFeesWei} wei of FCC fees observed on chain, so FCC fees were lost before the ` +
        `Merkle tree was built.`
    );
  }
  if (
    isFccFeesAddressExclusive() &&
    reconciliation.finalDirectClaimToFccAddressWei !== reconciliation.observedFeesWei
  ) {
    throw new Error(
      `FCC reconciliation failed for reward epoch ${reconciliation.rewardEpochId}: the final reward distribution ` +
        `assigns ${reconciliation.finalDirectClaimToFccAddressWei} wei to ${FCC_FEES_ADDRESS}, which is used only ` +
        `for FCC fees, but ${reconciliation.observedFeesWei} wei of FCC fees were observed on chain.`
    );
  }
  if (reconciliation.unpairedFdc2Requests > 0) {
    throw new Error(
      `FCC reconciliation failed for reward epoch ${reconciliation.rewardEpochId}: ` +
        `${reconciliation.unpairedFdc2Requests} FDC2 attestation requests have no paired TeeInstructionsSent event. ` +
        `Every FDC2 request emits both in the same transaction, so events are missing from the indexer.`
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
   * Undefined when the node could not be reached, which is reported but not treated as an accounting failure.
   */
  rewardManagerTotalRewardsWei?: bigint;
  /**
   * totalClaimsWei - rewardManagerTotalRewardsWei, when the on-chain total is available.
   *
   * Expected to be negative on networks with P-chain staking, and it is reported rather than asserted for that
   * reason. `ValidatorRewardOffersManager` resolves the same `RewardManager` through the address updater and credits
   * the staking inflation to it, but the matching staking claims are produced by a different process, not by this
   * one. On Coston2 reward epoch 5877 this calculation therefore covered exactly 70% of the epoch's inflation
   * (35% FTSO scaling and fast updates, 35% FDC), leaving the 30% staking share uncovered.
   *
   * So this figure can only become an equality check once staking claims are accounted for alongside these.
   * The FCC-specific checks above are unaffected: they are exact and do fail hard.
   */
  rewardManagerResidualWei?: bigint;
}

/**
 * Reconciles the FCC fees of a reward epoch, writes the report and fails hard if the FCC accounting does not balance.
 *
 * Also compares the sum of all claims against the funds RewardManager holds for the epoch. That comparison spans
 * every reward source, not just FCC, so it is reported rather than fatal: a pre-existing discrepancy in a legacy
 * source must not block the epoch. The FCC-specific checks above are exact and do fail hard.
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

  const totals = await getRewardEpochTotals(rewardEpochId);
  if (totals === undefined) {
    logger.error(
      `FCC reconciliation for reward epoch ${rewardEpochId}: could not read RewardManager totals over RPC, ` +
        `the claims could not be checked against the funds actually held. The FCC checks still ran.`
    );
  } else {
    report.rewardManagerTotalRewardsWei = totals.totalRewardsWei;
    report.rewardManagerResidualWei = totalClaimsWei - totals.totalRewardsWei;
    if (report.rewardManagerResidualWei !== 0n) {
      logger.error(
        `Reward epoch ${rewardEpochId}: claims total ${totalClaimsWei} wei but RewardManager holds ` +
          `${totals.totalRewardsWei} wei for the epoch (residual ${report.rewardManagerResidualWei} wei). ` +
          `This spans all reward sources, not only FCC.`
      );
    }
  }

  writeFileSync(
    path.join(calculationFolder, `${rewardEpochId}`, FCC_RECONCILIATION_FILE),
    JSON.stringify(report, bigIntReplacer, 2)
  );

  // Fails hard: these are exact, so a mismatch means funds on RewardManager are not fully covered by claims.
  assertFccReconciliation(reconciliation);

  if (reconciliation.eventsWithForeignRewardEpochId > 0) {
    logger.error(
      `Reward epoch ${rewardEpochId}: ${reconciliation.eventsWithForeignRewardEpochId} TeeInstructionsSent events ` +
        `carry a different reward epoch id than the epoch they were bucketed into. Funds credited on chain to one ` +
        `epoch are being claimed in another.`
    );
  }
  logger.log(
    `FCC reconciliation for reward epoch ${rewardEpochId}: ${reconciliation.observedFeesWei} wei of FCC fees ` +
      `across ${reconciliation.votingRoundsWithFccActivity} voting rounds, fully claimed to ${FCC_FEES_ADDRESS}.`
  );
  return report;
}
