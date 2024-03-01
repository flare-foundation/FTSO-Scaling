import fs from "fs";
import path from "path/posix";
import { CALCULATIONS_FOLDER } from "../../configs/networks";
import { DataForRewardCalculation } from "../../data-calculation-interfaces";
import { bigIntReplacer } from "../big-number-serialization";
import { REWARD_CALCULATION_DATA_FILE } from "./constants";
import { IRevealData } from "../RevealData";
import { GenericSubmissionData, ParsedFinalizationData } from "../../IndexerClient";
import { ISignaturePayload } from "../../../../fsp-utils/src/SignaturePayload";
import { hashToPrivateScalar } from "ccxt/js/src/static_dependencies/noble-curves/abstract/modular";


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
}

export function prepareDataForCalculations(rewardEpochId: number, data: DataForRewardCalculation): SDataForCalculation {
  const validEligibleReveals: RevealRecords[] = [];
  for (let [submitAddress, revealData] of data.dataForCalculations.validEligibleReveals.entries()) {
    validEligibleReveals.push({ submitAddress, data: revealData });
  }
  const voterMedianVotingWeights: VoterWeightData[] = [];
  for (let [submitAddress, weight] of data.dataForCalculations.voterMedianVotingWeights.entries()) {
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
  }
  return result;
}

export interface HashSignatures {
  hash: string;
  signatures: GenericSubmissionData<ISignaturePayload>[];
}

export interface SDataForRewardCalculation {
  dataForCalculations: SDataForCalculation;
  signatures: HashSignatures[];
  finalizations: ParsedFinalizationData[];
  firstSuccessfulFinalization?: ParsedFinalizationData;
}

/**
 * Serializes reward epoch info to disk.
 * In particular it stores the info in
 *  `<calculationsFolder>/<rewardEpochId>/REWARD_EPOCH_INFO_FILE`
 */
export function serializeDataForRewardCalculation(
  rewardEpochId: number,
  rewardCalculationData: DataForRewardCalculation,
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  if (!fs.existsSync(rewardEpochFolder)) {
    fs.mkdirSync(rewardEpochFolder);
  }
  const votingRoundFolder = path.join(rewardEpochFolder, `${rewardCalculationData.dataForCalculations.votingRoundId}`);
  const rewardCalculationsDataPath = path.join(votingRoundFolder, REWARD_CALCULATION_DATA_FILE);

  const hashSignatures: HashSignatures[] = [];
  for (let [hash, signatures] of rewardCalculationData.signatures.entries()) {
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
  };
  fs.writeFileSync(rewardCalculationsDataPath, JSON.stringify(data, bigIntReplacer));
}
