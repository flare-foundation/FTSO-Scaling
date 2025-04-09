import { FTSO2_PROTOCOL_ID } from "../../../../ftso-core/src/constants";
import { BURN_ADDRESS, FDC_PROTOCOL_ID, FTSO2_FAST_UPDATES_PROTOCOL_ID, STAKING_PROTOCOL_ID } from "../../constants";
import { ClaimType, IRewardClaim } from "../../utils/RewardClaim";
import { deserializePartialClaimsForVotingRoundId } from "../../utils/stat-info/partial-claims";
import { deserializeDataForRewardCalculation } from "../../utils/stat-info/reward-calculation-data";
import {
  deserializeRewardDistributionData,
  serializeRewardDistributionData,
} from "../../utils/stat-info/reward-distribution-data";
import { deserializeRewardEpochInfo } from "../../utils/stat-info/reward-epoch-info";
import { RewardTypePrefix } from "../RewardTypePrefix";
import {
  FDC_REWARDED_SHARE_PPM,
  FTSO_SCALING_AVAILABILITY_THRESHOLD_PPM,
  FTSO_SCALING_CLOSENESS_THRESHOLD_PPM,
  FU_CONSIDERATION_THRESHOLD_PPM,
  FU_THRESHOLD_PPM,
  MAX_NUMBER_OF_PASSES,
  STAKING_MIN_DESIRED_SELF_BOND_GWEI,
  STAKING_MIN_DESIRED_STAKE_GWEI,
  STAKING_MIN_SELF_BOND_GWEI,
  STAKING_UPTIME_THRESHOLD_PPM,
  TOTAL_PPM,
} from "./minimal-conditions-constants";
import { readListedDataProviders, readPassesInfo, readStakingInfo } from "./minimal-conditions-data";
import {
  DataProviderConditions,
  DataProviderPasses,
  FUConditionSummary,
  FdcConditionSummary,
  FeedHits,
  FtsoScalingConditionSummary,
  MinimalConditionFailure,
  MinimalConditionFailureType,
  NodeStakingConditions,
  StakingConditionSummary,
  ValidatorInfo,
} from "./minimal-conditions-interfaces";
// remove this and appearances of this when min conditions for FDC start to get used.
const FDC_MIN_CONDITIONS_IGNORE = true;

function networkId() {
  if (process.env.NETWORK === "flare") {
    return 14;
  }
  if (process.env.NETWORK === "songbird") {
    return 19;
  }
  throw new Error(`Network ${process.env.NETWORK} not supported`);
}

function toFeedName(hex: string) {
  let result = "";
  for (let i = 4; i < hex.length; i += 2) {
    const charHexCode = hex.slice(i, i + 2);
    if (charHexCode === "00") {
      continue;
    }
    result += String.fromCharCode(parseInt(charHexCode, 16));
  }
  return result;
}

export function calculateMinimalConditions(rewardEpochId: number): DataProviderConditions[] {
  const rewardEpochInfo = deserializeRewardEpochInfo(rewardEpochId);
  // returns undefined if the file is not found
  const passesInputData = readPassesInfo(rewardEpochId - 1);
  console.log(`Read ${passesInputData.length} passes entires for reward epoch ${rewardEpochId - 1}`);
  const submitAddressToVoter = new Map<string, string>();
  const voterToSubmitAddress = new Map<string, string>();
  const signingPolicyAddressToVoter = new Map<string, string>();
  const voterToVoterIndex = new Map<string, number>();
  const voterToFtsoScalingConditionSummary = new Map<string, FtsoScalingConditionSummary>();
  const voterToFUConditionSummary = new Map<string, FUConditionSummary>();
  const voterToStakingConditionSummary = new Map<string, StakingConditionSummary>();
  const voterToFdcConditionSummary = new Map<string, FdcConditionSummary>();
  const nodeIdToVoter = new Map<string, string>();
  const delegationAddressToVoter = new Map<string, string>();
  const voterToDelegateAddress = new Map<string, string>();
  const voterToNodeIds = new Map<string, string[]>();
  const nodeIdToNodeStakingCondition = new Map<string, NodeStakingConditions>();
  const submitAddressToFeedToHits = new Map<string, Map<string, FeedHits>>();
  const voterToPassesInputData = new Map<string, DataProviderPasses>();
  const voterToName = new Map<string, string>();

  const stakingIncluded = process.env.NETWORK === "flare";

  const totalSigningWeight = rewardEpochInfo.signingPolicy.weights.reduce((acc, weight) => acc + weight, 0);

  const numberOfVotingRounds = rewardEpochInfo.endVotingRoundId - rewardEpochInfo.signingPolicy.startVotingRoundId + 1;

  for (const dataProviderPasses of passesInputData) {
    const voter = dataProviderPasses.voterAddress.toLowerCase();
    voterToPassesInputData.set(voter, dataProviderPasses);
  }

  for (let i = 0; i < rewardEpochInfo.voterRegistrationInfo.length; i++) {
    const voter = rewardEpochInfo.voterRegistrationInfo[i].voterRegistered.voter.toLowerCase();
    const signingWeight = rewardEpochInfo.signingPolicy.weights[i];
    const submissionAddress = rewardEpochInfo.voterRegistrationInfo[i].voterRegistered.submitAddress.toLowerCase();
    const signingPolicyAddress =
      rewardEpochInfo.voterRegistrationInfo[i].voterRegistered.signingPolicyAddress.toLowerCase();
    const delegationAddress =
      rewardEpochInfo.voterRegistrationInfo[i].voterRegistrationInfo.delegationAddress.toLowerCase();
    submitAddressToVoter.set(submissionAddress, voter);
    voterToSubmitAddress.set(voter, submissionAddress);
    signingPolicyAddressToVoter.set(signingPolicyAddress, voter);
    delegationAddressToVoter.set(delegationAddress, voter);
    voterToDelegateAddress.set(voter, delegationAddress);
    voterToNodeIds.set(voter, rewardEpochInfo.voterRegistrationInfo[i].voterRegistrationInfo.nodeIds);
    voterToVoterIndex.set(voter, i);
    const ftsoScalingConditionSummary: FtsoScalingConditionSummary = {
      allPossibleHits: numberOfVotingRounds * rewardEpochInfo.canonicalFeedOrder.length,
      conditionMet: false,
      totalHits: 0,
      feedHits: [],
    };
    voterToFtsoScalingConditionSummary.set(voter, ftsoScalingConditionSummary);
    const proportionUpdatesPPM = (BigInt(signingWeight) * TOTAL_PPM) / BigInt(totalSigningWeight);
    const expectedUpdatesPPM = (BigInt(signingWeight) * FU_THRESHOLD_PPM) / BigInt(totalSigningWeight);
    const fuConditionSummary: FUConditionSummary = {
      conditionMet: false,
      totalUpdatesByAll: 0,
      updates: 0,
      expectedUpdatesPPM,
      expectedUpdates: 0n,
      tooLowWeight: proportionUpdatesPPM < FU_CONSIDERATION_THRESHOLD_PPM,
    };
    voterToFUConditionSummary.set(voter, fuConditionSummary);
    const stakingConditionSummary: StakingConditionSummary = {
      conditionMet: false,
      totalSelfBond: 0n,
      stake: 0n,
      stakeWithUptime: 0n,
      nodeConditions: [],
    };

    voterToStakingConditionSummary.set(voter, stakingConditionSummary);
    for (let j = 0; j < rewardEpochInfo.voterRegistrationInfo[i].voterRegistrationInfo.nodeIds.length; j++) {
      const nodeId = rewardEpochInfo.voterRegistrationInfo[i].voterRegistrationInfo.nodeIds[j];
      const stake = rewardEpochInfo.voterRegistrationInfo[i].voterRegistrationInfo.nodeWeights[j];
      // will be updated later from staking file
      const nodeCondition: NodeStakingConditions = {
        nodeId: nodeId,
        uptimeOk: false,
        selfBond: 0n,
        totalMirroredStake: stake,
        totalStakeAmount: 0n,
      };
      stakingConditionSummary.nodeConditions.push(nodeCondition);
      nodeIdToVoter.set(nodeId, voter);
      nodeIdToNodeStakingCondition.set(nodeId, nodeCondition);
    }
    const voterFeedHits = new Map<string, FeedHits>();
    for (const feedInfo of rewardEpochInfo.canonicalFeedOrder) {
      const feedHits: FeedHits = {
        feedName: toFeedName(feedInfo.id),
        feedHits: 0,
        totalHits: numberOfVotingRounds,
      };
      voterFeedHits.set(feedInfo.id, feedHits);
    }
    submitAddressToFeedToHits.set(submissionAddress, voterFeedHits);

    const fdcConditionSummary: FdcConditionSummary = {
      conditionMet: false,
      totalRewardedVotingRounds: 0,
      rewardedVotingRounds: 0,
    };
    voterToFdcConditionSummary.set(voter, fdcConditionSummary);
  }

  const dataProviderData = readListedDataProviders();
  for (const provider of dataProviderData.providers) {
    if (provider.chainId !== networkId()) {
      continue;
    }
    const delegationAddress = provider.address.toLowerCase();
    const voter = delegationAddressToVoter.get(delegationAddress);
    if (voter !== undefined) {
      voterToName.set(voter, provider.name);
    }
  }

  // Reading staking info data for reward epoch and updating node conditions
  const validatorInfoList: ValidatorInfo[] = stakingIncluded ? readStakingInfo(rewardEpochId) : [];
  if (!stakingIncluded) {
    console.log(`Staking data not relevant for the network ${process.env.NETWORK}`);
  }
  for (const validatorInfo of validatorInfoList) {
    const nodeId = validatorInfo.nodeId20Byte;
    const condition = nodeIdToNodeStakingCondition.get(nodeId);
    if (condition === undefined) {
      // TODO: log properly
      console.log(
        `Node ${nodeId} / ${validatorInfo.nodeId} by ${validatorInfo.ftsoName} not found in the voter registration info`
      );
      continue;
    }
    condition.selfBond = BigInt(validatorInfo.selfBond);
    condition.totalStakeAmount = BigInt(validatorInfo.totalStakeAmount);
    // TODO: check if this will stay so
    condition.uptimeOk = validatorInfo.uptimeEligible;
  }

  // Checking staking conditions
  for (const [_, stakingConditionSummary] of voterToStakingConditionSummary.entries()) {
    if (!stakingIncluded) {
      stakingConditionSummary.conditionMet = true;
      continue;
    }
    for (const nodeCondition of stakingConditionSummary.nodeConditions) {
      if (nodeCondition.uptimeOk) {
        stakingConditionSummary.stakeWithUptime += nodeCondition.totalStakeAmount;
      }
      stakingConditionSummary.totalSelfBond += nodeCondition.selfBond;
      stakingConditionSummary.stake += nodeCondition.totalStakeAmount;
    }
    // STAKING_UPTIME_THRESHOLD_PPM (80%) of total weight must have sufficient uptime
    const uptimeOk =
      TOTAL_PPM * stakingConditionSummary.stakeWithUptime >=
      STAKING_UPTIME_THRESHOLD_PPM * stakingConditionSummary.stake;

    stakingConditionSummary.conditionMet =
      uptimeOk && stakingConditionSummary.totalSelfBond >= STAKING_MIN_SELF_BOND_GWEI;
    stakingConditionSummary.obstructsPass =
      stakingConditionSummary.totalSelfBond < STAKING_MIN_DESIRED_SELF_BOND_GWEI ||
      stakingConditionSummary.stake < STAKING_MIN_DESIRED_STAKE_GWEI;
  }

  // Processing by voting rounds
  let totalFUUpdates = 0;
  let nonEmptyFeedValues = 0;
  let totalRewardedVotingRounds = 0;
  for (
    let votingRoundId = rewardEpochInfo.signingPolicy.startVotingRoundId;
    votingRoundId <= rewardEpochInfo.endVotingRoundId;
    votingRoundId++
  ) {
    if (votingRoundId % 100 === 0) console.log(votingRoundId);
    const rewardCalculationData = deserializeDataForRewardCalculation(rewardEpochId, votingRoundId);

    // Fast updates checks
    if (!rewardCalculationData?.fastUpdatesData?.signingPolicyAddressesSubmitted) {
      continue;
    }
    for (const signingPolicyAddress of rewardCalculationData.fastUpdatesData.signingPolicyAddressesSubmitted) {
      totalFUUpdates++;
      const voter = signingPolicyAddressToVoter.get(signingPolicyAddress);
      if (!voter) {
        // sanity check
        throw new Error(`Voter not found for signing policy address ${signingPolicyAddress}`);
      }
      const fuConditionSummary = voterToFUConditionSummary.get(voter);
      fuConditionSummary.updates++;
    }

    // FTSO Scaling checks
    for (const feedRecord of rewardCalculationData.medianCalculationResults) {
      const feedId = feedRecord.feed.id;
      if (feedRecord.data.finalMedian.isEmpty) {
        continue;
      }
      const median = feedRecord.data.finalMedian.value;
      nonEmptyFeedValues++;
      const delta = (BigInt(median) * FTSO_SCALING_CLOSENESS_THRESHOLD_PPM) / TOTAL_PPM;
      const low = median - Number(delta);
      const high = median + Number(delta);

      if (feedRecord.feedValues.length !== feedRecord.votersSubmitAddresses.length) {
        // sanity check
        throw new Error(`Feed values and voters submit addresses length mismatch for feed ${feedId}`);
      }
      for (let i = 0; i < feedRecord.feedValues.length; i++) {
        const submitAddress = feedRecord.votersSubmitAddresses[i];
        const feedValue = feedRecord.feedValues[i];
        const feedHits = submitAddressToFeedToHits.get(submitAddress)?.get(feedId);
        if (!feedHits) {
          // sanity check
          throw new Error(`Feed hits not found for submit address ${submitAddress} and feed ${feedId}`);
        }
        if (feedRecord.data.finalMedian.decimals !== feedValue.decimals) {
          // sanity check
          throw new Error(`Decimals mismatch for feed ${feedId}`);
        }
        // boundaries included
        if (feedValue.value >= low && feedValue.value <= high) {
          feedHits.feedHits++;
        }
      }
    }

    // FDC checks
    const claims = deserializePartialClaimsForVotingRoundId(rewardEpochId, votingRoundId);
    const hasFdcSigningFee = new Set<string>();
    const hasFdcFinalizationFee = new Set<string>();
    const hasFdcOffense = new Set<string>();
    for (const claim of claims) {
      if (claim.protocolTag !== "200") continue;
      if (claim.claimType === ClaimType.FEE) {
        if (claim.rewardTypeTag === RewardTypePrefix.FDC_SIGNING) {
          hasFdcSigningFee.add(claim.beneficiary.toLowerCase());
        }
        if (claim.rewardTypeTag === RewardTypePrefix.FDC_FINALIZATION) {
          hasFdcFinalizationFee.add(claim.beneficiary.toLowerCase());
        }
        if (claim.rewardTypeTag === RewardTypePrefix.FDC_OFFENDERS) {
          hasFdcOffense.add(claim.beneficiary.toLowerCase());
        }
      }
    }
    if (hasFdcSigningFee.size > 0 || hasFdcFinalizationFee.size > 0) {
      totalRewardedVotingRounds++;
    }
    for (const [voter, fdcConditionSummary] of voterToFdcConditionSummary.entries()) {
      if ((hasFdcSigningFee.has(voter) || hasFdcFinalizationFee.has(voter)) && !hasFdcOffense.has(voter)) {
        fdcConditionSummary.rewardedVotingRounds++;
      }
    }
  }

  // go over all data providers and check minimal conditions for fast updates
  for (const [_, fuConditionSummary] of voterToFUConditionSummary.entries()) {
    fuConditionSummary.totalUpdatesByAll = totalFUUpdates;
    fuConditionSummary.expectedUpdates = (fuConditionSummary.expectedUpdatesPPM * BigInt(totalFUUpdates)) / TOTAL_PPM;
    fuConditionSummary.conditionMet =
      fuConditionSummary.tooLowWeight ||
      TOTAL_PPM * BigInt(fuConditionSummary.updates) >= fuConditionSummary.expectedUpdatesPPM * BigInt(totalFUUpdates);
  }

  for (const [voter, ftsoScalingConditionSummary] of voterToFtsoScalingConditionSummary.entries()) {
    for (const feed of rewardEpochInfo.canonicalFeedOrder) {
      const feedId = feed.id;
      const feedHits = submitAddressToFeedToHits.get(voterToSubmitAddress.get(voter))?.get(feedId);
      if (!feedHits) {
        // sanity check
        throw new Error(`Feed hits not found for voter ${voter} and feed ${feedId}`);
      }
      ftsoScalingConditionSummary.feedHits.push(feedHits);
      ftsoScalingConditionSummary.totalHits += feedHits.feedHits;
    }
    ftsoScalingConditionSummary.conditionMet =
      TOTAL_PPM * BigInt(ftsoScalingConditionSummary.totalHits) >=
      FTSO_SCALING_AVAILABILITY_THRESHOLD_PPM * BigInt(ftsoScalingConditionSummary.allPossibleHits);
  }

  for (const [_, fdcConditionSummary] of voterToFdcConditionSummary.entries()) {
    fdcConditionSummary.totalRewardedVotingRounds = totalRewardedVotingRounds;
    fdcConditionSummary.conditionMet =
      TOTAL_PPM * BigInt(fdcConditionSummary.rewardedVotingRounds) >=
      FDC_REWARDED_SHARE_PPM * BigInt(fdcConditionSummary.totalRewardedVotingRounds);
  }

  const dataProviderConditions: DataProviderConditions[] = [];
  for (const regInfo of rewardEpochInfo.voterRegistrationInfo) {
    const voter = regInfo.voterRegistered.voter.toLowerCase();
    const ftsoScaling = voterToFtsoScalingConditionSummary.get(voter);
    const fastUpdates = voterToFUConditionSummary.get(voter);
    const staking = voterToStakingConditionSummary.get(voter);
    const fdc = voterToFdcConditionSummary.get(voter);
    const voterIndex = voterToVoterIndex.get(voter);

    if (ftsoScaling === undefined) {
      throw new Error(`FTSO scaling condition summary not found for voter ${voter}`);
    }
    if (fastUpdates === undefined) {
      throw new Error(`Fast updates condition summary not found for voter ${voter}`);
    }
    if (staking === undefined) {
      throw new Error(`Staking condition summary not found for voter ${voter}`);
    }
    if (fdc === undefined) {
      throw new Error(`FDC condition summary not found for voter ${voter}`);
    }
    if (voterIndex === undefined) {
      throw new Error(`Voter index not found for voter ${voter}`);
    }
    const passes = voterToPassesInputData.get(voter);
    const passesHeld = passes?.passes ?? 0;
    // assemble all DataProviderConditions for each data provider
    let passEarned = false;
    if (
      ftsoScaling.conditionMet &&
      fastUpdates.conditionMet &&
      staking.conditionMet &&
      !staking.obstructsPass &&
      (fdc.conditionMet || FDC_MIN_CONDITIONS_IGNORE)
    ) {
      passEarned = true;
    }
    let strikes = 0;
    if (!ftsoScaling.conditionMet) {
      strikes++;
    }
    if (!fastUpdates.conditionMet) {
      strikes++;
    }
    if (!staking.conditionMet) {
      strikes++;
    }
    if (!fdc.conditionMet && !FDC_MIN_CONDITIONS_IGNORE) {
      strikes++;
    }

    const eligibleForReward = passesHeld - strikes >= 0;
    // Cannot go below zero
    let newNumberOfPasses = Math.max(passesHeld - strikes, 0);
    if (passEarned) {
      newNumberOfPasses++;
    }
    newNumberOfPasses = Math.min(newNumberOfPasses, MAX_NUMBER_OF_PASSES);
    const dataProviderCondition: DataProviderConditions = {
      rewardEpochId,
      network: process.env.NETWORK,
      dataProviderName: voterToName.get(voter),
      voterAddress: voter,
      delegationAddress: voterToDelegateAddress.get(voter),
      nodeIds: voterToNodeIds.get(voter),
      voterIndex: voterToVoterIndex.get(voter),
      passesHeld,
      passEarned,
      strikes,
      eligibleForReward,
      newNumberOfPasses,
      ftsoScaling,
      fastUpdates,
      staking,
      fdc,
    };
    dataProviderConditions.push(dataProviderCondition);
  }

  return dataProviderConditions;
}

export function extractNewPasses(dataProviderConditions: DataProviderConditions[]): DataProviderPasses[] {
  const result: DataProviderPasses[] = [];
  for (const dataProviderCondition of dataProviderConditions) {
    let allPasses = dataProviderCondition.passesHeld;
    if (dataProviderCondition.passEarned) {
      allPasses++;
    } else {
      allPasses = Math.max(allPasses - dataProviderCondition.strikes, 0);
    }
    // For now we will include 0 pass entries in new passes file
    // though they are not necessary
    // if (allPasses == 0) {
    //    continue;
    // }
    const failures: MinimalConditionFailure[] = [];
    if (!dataProviderCondition.ftsoScaling.conditionMet) {
      failures.push({
        protocolId: FTSO2_PROTOCOL_ID,
        failureId: MinimalConditionFailureType.FTSO_SCALING_FAILURE,
      });
    }
    if (!dataProviderCondition.fastUpdates.conditionMet) {
      failures.push({
        protocolId: FTSO2_FAST_UPDATES_PROTOCOL_ID,
        failureId: MinimalConditionFailureType.FAST_UPDATES_FAILURE,
      });
    }
    if (!dataProviderCondition.staking.conditionMet) {
      failures.push({
        protocolId: STAKING_PROTOCOL_ID,
        failureId: MinimalConditionFailureType.STAKING_FAILURE,
      });
    }
    if (!dataProviderCondition.fdc.conditionMet) {
      failures.push({
        protocolId: FDC_PROTOCOL_ID,
        failureId: MinimalConditionFailureType.FDC_FAILURE,
      });
    }

    const dataProviderPasses: DataProviderPasses = {
      rewardEpochId: dataProviderCondition.rewardEpochId,
      dataProviderName: dataProviderCondition.dataProviderName,
      eligibleForReward: dataProviderCondition.eligibleForReward,
      voterAddress: dataProviderCondition.voterAddress,
      passes: Math.min(allPasses, MAX_NUMBER_OF_PASSES),
      failures,
    };
    result.push(dataProviderPasses);
  }
  return result;
}

export function updateClaimsForMinimalConditions(
  rewardEpochId: number,
  dataProviderConditions: DataProviderConditions[]
): void {
  // handle case with len = 0
  const beneficiariesToBurn = new Set<string>();
  for (const dataProviderCondition of dataProviderConditions) {
    if (dataProviderCondition.eligibleForReward) {
      continue;
    }
    beneficiariesToBurn.add(dataProviderCondition.voterAddress.toLowerCase());
    beneficiariesToBurn.add(dataProviderCondition.delegationAddress.toLowerCase());
    for (const nodeId of dataProviderCondition.nodeIds) {
      beneficiariesToBurn.add(nodeId.toLowerCase());
    }
  }
  beneficiariesToBurn.add(BURN_ADDRESS.toLowerCase());

  const rewardDistributionData = deserializeRewardDistributionData(rewardEpochId);
  const claims = rewardDistributionData.rewardClaims.map(item => item.body);
  const fullClaims = claims.filter(claim => !beneficiariesToBurn.has(claim.beneficiary.toLowerCase()));
  const claimsToBurn = claims.filter(claim => beneficiariesToBurn.has(claim.beneficiary.toLowerCase()));
  const burnClaim: IRewardClaim = {
    beneficiary: BURN_ADDRESS.toLowerCase(),
    amount: claimsToBurn.reduce((acc, claim) => acc + claim.amount, 0n),
    claimType: ClaimType.DIRECT,
    rewardEpochId,
  };
  const newClaims = [burnClaim, ...fullClaims];
  newClaims.sort((a, b) => a.beneficiary.localeCompare(b.beneficiary));
  // sanity check - no double beneficiaries
  const seenBeneficiaries = new Set<string>();
  for (const claim of newClaims) {
    if (claim.beneficiary.toLowerCase() !== claim.beneficiary) {
      throw new Error(`Beneficiary address not in lowercase: ${claim.beneficiary}`);
    }
    if (seenBeneficiaries.has(claim.beneficiary)) {
      throw new Error(`Duplicate beneficiary: ${claim.beneficiary}`);
    }
    seenBeneficiaries.add(claim.beneficiary);
  }
  // true indicates applied min conditions
  serializeRewardDistributionData(rewardEpochId, newClaims, true);
}
