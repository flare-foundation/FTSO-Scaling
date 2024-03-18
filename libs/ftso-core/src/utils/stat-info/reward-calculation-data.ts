import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path/posix";
import { ISignaturePayload } from "../../../../fsp-utils/src/SignaturePayload";
import { GenericSubmissionData, ParsedFinalizationData } from "../../IndexerClient";
import { CALCULATIONS_FOLDER } from "../../configs/networks";
import { DataForRewardCalculation } from "../../data-calculation-interfaces";
import { IRevealData } from "../RevealData";
import { bigIntReplacer, bigIntReviver } from "../big-number-serialization";
import { REWARD_CALCULATION_DATA_FILE } from "./constants";
import { Feed, MedianCalculationResult, MedianCalculationSummary, RandomCalculationResult } from "../../voting-types";
import { ValueWithDecimals } from "../FeedValueEncoder";

export interface RevealRecords {
  submitAddress: string;
  data: IRevealData;
}

export interface VoterWeightData {
  submitAddress: string;
  weight: bigint;
}

export interface SDataForCalculation {
  rewardEpochId: number;
  votingRoundId: number;
  orderedVotersSubmitAddresses: string[];
  validEligibleReveals: RevealRecords[];
  revealOffenders: string[];
  voterMedianVotingWeights: VoterWeightData[];
  randomGenerationBenchingWindow: number;
  benchingWindowRevealOffenders: string[];
  feedOrder: Feed[];
}

export function prepareDataForCalculations(rewardEpochId: number, data: DataForRewardCalculation): SDataForCalculation {
  const validEligibleReveals: RevealRecords[] = [];
  for (const [submitAddress, revealData] of data.dataForCalculations.validEligibleReveals.entries()) {
    validEligibleReveals.push({ submitAddress, data: revealData });
  }
  const voterMedianVotingWeights: VoterWeightData[] = [];
  for (const [submitAddress, weight] of data.dataForCalculations.voterMedianVotingWeights.entries()) {
    voterMedianVotingWeights.push({ submitAddress, weight });
  }
  const result: SDataForCalculation = {
    rewardEpochId,
    votingRoundId: data.dataForCalculations.votingRoundId,
    orderedVotersSubmitAddresses: data.dataForCalculations.orderedVotersSubmitAddresses,
    validEligibleReveals,
    revealOffenders: [...data.dataForCalculations.revealOffenders],
    voterMedianVotingWeights,
    randomGenerationBenchingWindow: data.dataForCalculations.randomGenerationBenchingWindow,
    benchingWindowRevealOffenders: [...data.dataForCalculations.benchingWindowRevealOffenders],
    feedOrder: data.dataForCalculations.feedOrder,
  };
  return result;
}

export interface HashSignatures {
  hash: string;
  signatures: GenericSubmissionData<ISignaturePayload>[];
}

export interface SimplifiedMedianCalculationResult {
  readonly feedValues: readonly ValueWithDecimals[];
  readonly summary: MedianCalculationSummary;
}

/**
 * Encapsulates the result of random calculation for a specific voting round.
 */
export interface SimplifiedRandomCalculationResult {
  readonly random: bigint;
  readonly isSecure: boolean;
}

export interface SDataForRewardCalculation {
  dataForCalculations: SDataForCalculation;
  signatures: HashSignatures[];
  finalizations: ParsedFinalizationData[];
  firstSuccessfulFinalization?: ParsedFinalizationData;
  medianSummaries: MedianCalculationSummary[];
  randomResult: SimplifiedRandomCalculationResult;
}

function simplifyRandomCalculationResult(randomResult: RandomCalculationResult): SimplifiedRandomCalculationResult {
  return {
    random: randomResult.random,
    isSecure: randomResult.isSecure,
  };
}

/**
 * Serializes reward epoch info to disk.
 * In particular it stores the info in
 *  `<calculationsFolder>/<rewardEpochId>/REWARD_EPOCH_INFO_FILE`
 */
export function serializeDataForRewardCalculation(
  rewardEpochId: number,
  rewardCalculationData: DataForRewardCalculation,
  medianResults: MedianCalculationResult[],
  randomResult: RandomCalculationResult,
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  if (!existsSync(rewardEpochFolder)) {
    mkdirSync(rewardEpochFolder);
  }
  const votingRoundFolder = path.join(rewardEpochFolder, `${rewardCalculationData.dataForCalculations.votingRoundId}`);
  const rewardCalculationsDataPath = path.join(votingRoundFolder, REWARD_CALCULATION_DATA_FILE);

  const hashSignatures: HashSignatures[] = [];
  for (const [hash, signatures] of rewardCalculationData.signatures.entries()) {
    const hashRecord: HashSignatures = {
      hash,
      signatures,
    };
    hashSignatures.push(hashRecord);
  }
  const data: SDataForRewardCalculation = {
    dataForCalculations: prepareDataForCalculations(rewardEpochId, rewardCalculationData),
    signatures: hashSignatures,
    finalizations: rewardCalculationData.finalizations,
    firstSuccessfulFinalization: rewardCalculationData.firstSuccessfulFinalization,
    medianSummaries: medianResults.map(res => res.data),
    randomResult: simplifyRandomCalculationResult(randomResult),
  };
  writeFileSync(rewardCalculationsDataPath, JSON.stringify(data, bigIntReplacer));
}

export function deserializeDataForRewardCalculation(
  rewardEpochId: number,
  votingRoundId: number
): SDataForRewardCalculation {
  const rewardEpochFolder = path.join(CALCULATIONS_FOLDER(), `${rewardEpochId}`);
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  const rewardCalculationsDataPath = path.join(votingRoundFolder, REWARD_CALCULATION_DATA_FILE);
  if (!existsSync(rewardCalculationsDataPath)) {
    throw new Error(`Reward calculation data for epoch ${rewardEpochId} does not exist.`);
  }
  const data = JSON.parse(
    readFileSync(rewardCalculationsDataPath, "utf-8"),
    bigIntReviver
  ) as SDataForRewardCalculation;
  return data;
}
