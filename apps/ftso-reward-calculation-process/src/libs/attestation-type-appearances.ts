import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path/posix";
import { FDC_ATTESTATION_APPEARANCES_FILE } from "../../../../libs/fsp-rewards/src/utils/stat-info/constants";
import { deserializeDataForRewardCalculation } from "../../../../libs/fsp-rewards/src/utils/stat-info/reward-calculation-data";
import { deserializeRewardEpochInfo } from "../../../../libs/fsp-rewards/src/utils/stat-info/reward-epoch-info";
import { AttestationRequest } from "../../../../libs/contracts/src/events/AttestationRequest";
import { CALCULATIONS_FOLDER } from "../../../../libs/fsp-rewards/src/constants";

export interface FDCAttestationRequestAppearances {
  attestationRequestId: string;
  attestationType: string;
  source: string;
  count: number;
}

/**
 * Calculates the number of appearances of each attestation type in the given reward epoch.
 */
export function calculateAttestationTypeAppearances(rewardEpochId: number): void {
  const rewardEpochInfo = deserializeRewardEpochInfo(rewardEpochId);

  const attestationTypeCount = new Map<string, number>();
  for (
    let votingRoundId = rewardEpochInfo.signingPolicy.startVotingRoundId;
    votingRoundId <= rewardEpochInfo.endVotingRoundId;
    votingRoundId++
  ) {
    const currentCalculationData = deserializeDataForRewardCalculation(rewardEpochId, votingRoundId);
    if (!currentCalculationData) {
      throw new Error(`Missing reward calculation data for voting round ${votingRoundId}`);
    }
    const attestationRequests = currentCalculationData?.fdcData?.attestationRequests;
    if (!attestationRequests) {
      continue;
    }
    for (const attestationRequest of attestationRequests) {
      if (attestationRequest.confirmed && !attestationRequest.duplicate) {
        const id = AttestationRequest.getPrefix(attestationRequest);
        if (id) {
          attestationTypeCount.set(id, (attestationTypeCount.get(id) || 0) + 1);
        }
      }
    }
  }
  const appearances: FDCAttestationRequestAppearances[] = [];
  for (const [attestationRequestId, appearancesCount] of attestationTypeCount.entries()) {
    const appearance: FDCAttestationRequestAppearances = {
      attestationRequestId,
      count: appearancesCount,
      attestationType: Buffer.from(attestationRequestId.slice(2, 66), "hex").toString("utf8").replaceAll("\0", ""),
      source: Buffer.from(attestationRequestId.slice(66, 130), "hex").toString("utf8").replaceAll("\0", ""),
    };
    appearances.push(appearance);
  }
  serializeAttestationRequestAppearances(appearances, rewardEpochId);
}

/**
 * Writes the data regarding attestation request appearances.
 * The data is stored in
 *   `<calculationsFolder>/<rewardEpochId>/FDC_ATTESTATION_APPEARANCES_FILE`.
 */
export function serializeAttestationRequestAppearances(
  appearances: FDCAttestationRequestAppearances[],
  rewardEpochId: number,
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  if (!existsSync(rewardEpochFolder)) {
    mkdirSync(rewardEpochFolder);
  }
  const appearancesPath = path.join(rewardEpochFolder, FDC_ATTESTATION_APPEARANCES_FILE);
  writeFileSync(appearancesPath, JSON.stringify(appearances));
}

/**
 * Deserializes attestation request appearances data.
 */
export function deserializeAttestationRequestAppearances(
  rewardEpochId: number,
  calculationFolder = CALCULATIONS_FOLDER()
): FDCAttestationRequestAppearances[] {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const appearancesPath = path.join(rewardEpochFolder, FDC_ATTESTATION_APPEARANCES_FILE);
  const data = JSON.parse(readFileSync(appearancesPath, "utf-8")) as FDCAttestationRequestAppearances[];
  return data;
}
