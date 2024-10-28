import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path/posix";
import { RelayMessage } from "../../../../fsp-utils/src/RelayMessage";
import { ISignaturePayload } from "../../../../fsp-utils/src/SignaturePayload";
import { GenericSubmissionData, ParsedFinalizationData } from "../../IndexerClient";
import { VoterWeights } from "../../RewardEpoch";
import { CALCULATIONS_FOLDER } from "../../configs/networks";
import { DataForRewardCalculation, FastUpdatesDataForVotingRound, SFDCDataForVotingRound } from "../../data-calculation-interfaces";
import { Address, Feed, MedianCalculationResult, MessageHash, RandomCalculationResult } from "../../voting-types";
import { IRevealData } from "../RevealData";
import { bigIntReplacer, bigIntReviver } from "../big-number-serialization";
import { REWARD_CALCULATION_DATA_FILE, TEMP_REWARD_EPOCH_FOLDER_PREFIX } from "./constants";
import { RewardEpochInfo } from "./reward-epoch-info";

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
  // Not serialized, reconstructed on augmentation
  validEligibleRevealsMap?: Map<string, IRevealData>;
  revealOffendersSet?: Set<string>;
  voterMedianVotingWeightsSet?: Map<Address, bigint>;
  benchingWindowRevealOffendersSet?: Set<Address>;
  totalSigningWeight?: number;
  signingAddressToSubmitAddress?: Map<Address, Address>;
  votersWeightsMap?: Map<Address, VoterWeights>;
  signerToSigningWeight?: Map<Address, number>;
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
    feedOrder: data.dataForCalculations.feedOrder
  };
  return result;
}

export interface HashSignatures {
  hash: string;
  signatures: GenericSubmissionData<ISignaturePayload>[];
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
  medianCalculationResults: MedianCalculationResult[];
  randomResult: SimplifiedRandomCalculationResult;
  fastUpdatesData?: FastUpdatesDataForVotingRound;
  fdcData?: SFDCDataForVotingRound;
  // usually added after results of the next voting round are known
  nextVotingRoundRandomResult?: string;
  eligibleFinalizers: string[];
  // not serialized, reconstructed on augmentation
  signaturesMap?: Map<MessageHash, GenericSubmissionData<ISignaturePayload>[]>;
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
  eligibleFinalizationRewardVotersInGracePeriod: string[],
  tempRewardEpochFolder = false,
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  const rewardEpochFolder = path.join(
    calculationFolder,
    `${tempRewardEpochFolder ? TEMP_REWARD_EPOCH_FOLDER_PREFIX : ""}${rewardEpochId}`
  );
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


  let fdcData: SFDCDataForVotingRound | undefined;

  if (rewardCalculationData.fdcData) {
    const fdcHashSignatures: HashSignatures[] = [];
    for (const [hash, signatures] of rewardCalculationData.fdcData.signaturesMap.entries()) {
      const hashRecord: HashSignatures = {
        hash,
        signatures,
      };
      fdcHashSignatures.push(hashRecord);
    }
    fdcData = {
      votingRoundId: rewardCalculationData.fdcData.votingRoundId,
      attestationRequests: rewardCalculationData.fdcData.attestationRequests,
      bitVotes: rewardCalculationData.fdcData.bitVotes,
      signatures: fdcHashSignatures,
      firstSuccessfulFinalization: rewardCalculationData.fdcData.firstSuccessfulFinalization,
      finalizations: rewardCalculationData.fdcData.finalizations,
      eligibleSigners: rewardCalculationData.fdcData.eligibleSigners,
      consensusBitVote: rewardCalculationData.fdcData.consensusBitVote,
      consensusBitVoteIndices: rewardCalculationData.fdcData.consensusBitVoteIndices,
      fdcOffenders: rewardCalculationData.fdcData.fdcOffenders,
    }
  }

  for (const finalization of rewardCalculationData.finalizations) {
    RelayMessage.augment(finalization.messages);
  }
  if (rewardCalculationData.firstSuccessfulFinalization?.messages) {
    RelayMessage.augment(rewardCalculationData.firstSuccessfulFinalization?.messages);
  }

  const data: SDataForRewardCalculation = {
    dataForCalculations: prepareDataForCalculations(rewardEpochId, rewardCalculationData),
    signatures: hashSignatures,
    finalizations: rewardCalculationData.finalizations,
    firstSuccessfulFinalization: rewardCalculationData.firstSuccessfulFinalization,
    medianCalculationResults: medianResults,
    randomResult: simplifyRandomCalculationResult(randomResult),
    eligibleFinalizers: eligibleFinalizationRewardVotersInGracePeriod,
    fastUpdatesData: rewardCalculationData.fastUpdatesData,
    fdcData
  };
  writeFileSync(rewardCalculationsDataPath, JSON.stringify(data, bigIntReplacer));
}

/**
 * Writes the data for reward calculation to disk.
 * The data is stored in
 *   `<calculationsFolder>/<rewardEpochId>/<votingRoundId>/REWARD_CALCULATION_DATA_FILE`.
 */
export function writeDataForRewardCalculation(
  data: SDataForRewardCalculation,
  tempRewardEpochFolder = false,
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  const rewardEpochFolder = path.join(
    calculationFolder,
    `${tempRewardEpochFolder ? TEMP_REWARD_EPOCH_FOLDER_PREFIX : ""}${data.dataForCalculations.rewardEpochId}`
  );
  if (!existsSync(rewardEpochFolder)) {
    mkdirSync(rewardEpochFolder);
  }
  const votingRoundFolder = path.join(rewardEpochFolder, `${data.dataForCalculations.votingRoundId}`);
  const rewardCalculationsDataPath = path.join(votingRoundFolder, REWARD_CALCULATION_DATA_FILE);
  writeFileSync(rewardCalculationsDataPath, JSON.stringify(data, bigIntReplacer));
}

/**
 * After deserialization, the data is augmented with additional maps and sets for easier access.
 */
function augmentDataForCalculation(data: SDataForCalculation, rewardEpochInfo: RewardEpochInfo): void {
  const validEligibleRevealsMap = new Map<string, IRevealData>();
  for (const reveal of data.validEligibleReveals) {
    validEligibleRevealsMap.set(reveal.submitAddress.toLowerCase(), reveal.data);
  }

  const revealOffendersSet = new Set<string>(data.revealOffenders);
  const voterMedianVotingWeightsSet = new Map<string, bigint>();
  for (const voter of data.voterMedianVotingWeights) {
    voterMedianVotingWeightsSet.set(voter.submitAddress.toLowerCase(), voter.weight);
  }
  const benchingWindowRevealOffendersSet = new Set<string>(
    data.benchingWindowRevealOffenders.map(address => address.toLowerCase())
  );
  data.validEligibleRevealsMap = validEligibleRevealsMap;
  data.revealOffendersSet = revealOffendersSet;
  data.voterMedianVotingWeightsSet = voterMedianVotingWeightsSet;
  data.benchingWindowRevealOffendersSet = benchingWindowRevealOffendersSet;

  data.totalSigningWeight = 0;
  for (let i = 0; i < rewardEpochInfo.signingPolicy.voters.length; i++) {
    const signingWeight = rewardEpochInfo.signingPolicy.weights[i];
    data.totalSigningWeight += signingWeight;
  }
  const signingAddressToSubmitAddress = new Map<string, string>();
  for (let i = 0; i < rewardEpochInfo.signingPolicy.voters.length; i++) {
    const signingAddress = rewardEpochInfo.signingPolicy.voters[i];
    const submitAddress = data.orderedVotersSubmitAddresses[i];
    signingAddressToSubmitAddress.set(signingAddress.toLowerCase(), submitAddress.toLowerCase());
  }
  data.signingAddressToSubmitAddress = signingAddressToSubmitAddress;

  const voterWeightsMap = new Map<Address, VoterWeights>();
  for (let i = 0; i < rewardEpochInfo.voterRegistrationInfo.length; i++) {
    const voterRegistrationInfo = rewardEpochInfo.voterRegistrationInfo[i];
    const voterWeights: VoterWeights = {
      identityAddress: voterRegistrationInfo.voterRegistered.voter.toLowerCase(),
      submitAddress: voterRegistrationInfo.voterRegistered.submitAddress.toLowerCase(),
      signingAddress: voterRegistrationInfo.voterRegistered.signingPolicyAddress.toLowerCase(),
      delegationAddress: voterRegistrationInfo.voterRegistrationInfo.delegationAddress.toLowerCase(),
      delegationWeight: voterRegistrationInfo.voterRegistrationInfo.wNatWeight,
      cappedDelegationWeight: voterRegistrationInfo.voterRegistrationInfo.wNatCappedWeight,
      signingWeight: rewardEpochInfo.signingPolicy.weights[i],
      feeBIPS: voterRegistrationInfo.voterRegistrationInfo.delegationFeeBIPS,
      nodeIds: voterRegistrationInfo.voterRegistrationInfo.nodeIds,
      nodeWeights: voterRegistrationInfo.voterRegistrationInfo.nodeWeights,
    };
    voterWeightsMap.set(voterRegistrationInfo.voterRegistered.submitAddress.toLowerCase(), voterWeights);
  }
  data.votersWeightsMap = voterWeightsMap;
  const signerToSigningWeight = new Map<Address, number>();
  for (let i = 0; i < rewardEpochInfo.signingPolicy.voters.length; i++) {
    const signingAddress = rewardEpochInfo.signingPolicy.voters[i];
    const signingWeight = rewardEpochInfo.signingPolicy.weights[i];
    signerToSigningWeight.set(signingAddress.toLowerCase(), signingWeight);
  }
  data.signerToSigningWeight = signerToSigningWeight;
}

/**
 * After deserialization, the data is augmented with additional maps and sets for easier access.
 */
export function augmentDataForRewardCalculation(
  data: SDataForRewardCalculation,
  rewardEpochInfo: RewardEpochInfo
): void {
  augmentDataForCalculation(data.dataForCalculations, rewardEpochInfo);
  const signaturesMap = new Map<string, GenericSubmissionData<ISignaturePayload>[]>();
  for (const hashSignature of data.signatures) {
    signaturesMap.set(hashSignature.hash, hashSignature.signatures);
  }
  data.signaturesMap = signaturesMap;
  augmentFdcDataForRewardCalculation(data.fdcData);
}

/**
 * After deserialization, the data is augmented with additional maps and sets for easier access.
 */
export function augmentFdcDataForRewardCalculation(
  data: SFDCDataForVotingRound,
): void {
  const signaturesMap = new Map<string, GenericSubmissionData<ISignaturePayload>[]>();
  for (const hashSignature of data.signatures) {
    signaturesMap.set(hashSignature.hash, hashSignature.signatures);
  }
  data.signaturesMap = signaturesMap;
}


export function deserializeDataForRewardCalculation(
  rewardEpochId: number,
  votingRoundId: number,
  tempRewardEpochFolder = false,
  calculationFolder = CALCULATIONS_FOLDER()
): SDataForRewardCalculation {
  const rewardEpochFolder = path.join(
    calculationFolder,
    `${tempRewardEpochFolder ? TEMP_REWARD_EPOCH_FOLDER_PREFIX : ""}${rewardEpochId}`
  );
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  const rewardCalculationsDataPath = path.join(votingRoundFolder, REWARD_CALCULATION_DATA_FILE);
  if (!existsSync(rewardCalculationsDataPath)) {
    throw new Error(
      `Reward calculation data for reward epoch ${rewardEpochId}, voting round ${votingRoundId} does not exist.`
    );
  }
  const data = JSON.parse(
    readFileSync(rewardCalculationsDataPath, "utf-8"),
    bigIntReviver
  ) as SDataForRewardCalculation;
  return data;
}
