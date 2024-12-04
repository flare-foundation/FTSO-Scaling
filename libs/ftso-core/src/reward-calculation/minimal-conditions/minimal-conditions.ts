import { deserializeDataForRewardCalculation } from "../../utils/stat-info/reward-calculation-data";
import { deserializeRewardEpochInfo } from "../../utils/stat-info/reward-epoch-info";
import {
   FTSO_SCALING_AVAILABILITY_THRESHOLD_PPM,
   FTSO_SCALING_CLOSENESS_THRESHOLD_PPM,
   FU_CONSIDERATION_THRESHOLD_PPM, FU_THRESHOLD_PPM,
   MAX_NUMBER_OF_PASSES,
   STAKING_MIN_DESIRED_SELF_BOND_GWEI,
   STAKING_MIN_DESIRED_STAKE_GWEI,
   STAKING_MIN_SELF_BOND_GWEI,
   STAKING_UPTIME_THRESHOLD_PPM,
   TOTAL_PPM
} from "./minimal-conditions-constants";
import { readPassesInfo, readStakingInfo } from "./minimal-conditions-data";
import {
   DataProviderConditions,
   DataProviderPasses,
   FUConditionSummary,
   FeedHits,
   FtsoScalingConditionSummary,
   NodeStakingConditions,
   StakingConditionSummary
} from "./minimal-conditions-interfaces";

export function calculateMinimalConditions(
   rewardEpochId: number,
   requirePassesFile: boolean
): DataProviderConditions[] {
   const rewardEpochInfo = deserializeRewardEpochInfo(rewardEpochId);
   // returns undefined if the file is not found
   let passesInputData = readPassesInfo(rewardEpochId - 1);
   if (requirePassesFile && passesInputData === undefined) {
      throw new Error(`Passes file not found for reward epoch ${rewardEpochId - 1}`);
   }
   if (!passesInputData) {
      passesInputData = [];
   }
   const submitAddressToVoter = new Map<string, string>();
   const voterToSubmitAddress = new Map<string, string>();
   const signingPolicyAddressToVoter = new Map<string, string>();
   const voterToVoterIndex = new Map<string, number>();
   const voterToFtsoScalingConditionSummary = new Map<string, FtsoScalingConditionSummary>();
   const voterToFUConditionSummary = new Map<string, FUConditionSummary>();
   const voterToStakingConditionSummary = new Map<string, StakingConditionSummary>();
   const nodeIdToVoter = new Map<string, string>();
   const nodeIdToNodeStakingCondition = new Map<string, NodeStakingConditions>();
   const submitAddressToFeedToHits = new Map<string, Map<string, FeedHits>>();
   const voterToPassesInputData = new Map<string, DataProviderPasses>();

   const totalSigningWeight = rewardEpochInfo.signingPolicy.weights.reduce((acc, weight) => acc + weight, 0);

   const numberOfVotingRounds = (rewardEpochInfo.endVotingRoundId - rewardEpochInfo.signingPolicy.startVotingRoundId + 1);

   for (let dataProviderPasses of passesInputData) {
      let voter = dataProviderPasses.voterAddress.toLowerCase();
      voterToPassesInputData.set(voter, dataProviderPasses);
   }

   for (let i = 0; i < rewardEpochInfo.voterRegistrationInfo.length; i++) {
      const voter = rewardEpochInfo.voterRegistrationInfo[i].voterRegistered.voter.toLowerCase();
      const signingWeight = rewardEpochInfo.signingPolicy.weights[i];
      const submissionAddress = rewardEpochInfo.voterRegistrationInfo[i].voterRegistered.submitAddress.toLowerCase();
      const signingPolicyAddress = rewardEpochInfo.voterRegistrationInfo[i].voterRegistered.signingPolicyAddress.toLowerCase();
      submitAddressToVoter.set(submissionAddress, voter);
      voterToSubmitAddress.set(voter, submissionAddress);
      signingPolicyAddressToVoter.set(signingPolicyAddress, voter);
      voterToVoterIndex.set(voter, i);
      const ftsoScalingConditionSummary: FtsoScalingConditionSummary = {
         allPossibleHits: numberOfVotingRounds * rewardEpochInfo.canonicalFeedOrder.length,
         conditionMet: false,
         totalHits: 0,
         feedHits: [],
      }
      voterToFtsoScalingConditionSummary.set(voter, ftsoScalingConditionSummary);
      const proportionUpdatesPPM = (BigInt(signingWeight) * TOTAL_PPM) / BigInt(totalSigningWeight);
      const expectedUpdatesPPM = (BigInt(signingWeight) * FU_THRESHOLD_PPM) / BigInt(totalSigningWeight);
      const fuConditionSummary: FUConditionSummary = {
         conditionMet: false,
         totalUpdatesByAll: 0,
         updates: 0,
         expectedUpdatesPPM,
         tooLowWeight: proportionUpdatesPPM < FU_CONSIDERATION_THRESHOLD_PPM,
      }
      voterToFUConditionSummary.set(voter, fuConditionSummary);
      const stakingConditionSummary: StakingConditionSummary = {
         conditionMet: false,
         totalSelfBond: 0n,
         stake: 0n,
         stakeWithUptime: 0n,
         nodeConditions: [],
      }

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
         }
         stakingConditionSummary.nodeConditions.push(nodeCondition);
         nodeIdToVoter.set(nodeId, voter);
         nodeIdToNodeStakingCondition.set(nodeId, nodeCondition);
      }
      const voterFeedHits = new Map<string, FeedHits>();
      for (let feedInfo of rewardEpochInfo.canonicalFeedOrder) {
         const feedHits: FeedHits = {
            feedId: feedInfo.id,
            feedHits: 0,
            totalHits: numberOfVotingRounds
         }
         voterFeedHits.set(feedInfo.id, feedHits);
      }
      submitAddressToFeedToHits.set(submissionAddress, voterFeedHits);
   }

   // Reading staking info data for reward epoch and updating node conditions
   const validatorInfoList = readStakingInfo(rewardEpochId);
   for (const validatorInfo of validatorInfoList) {
      const nodeId = validatorInfo.nodeId20Byte;
      const condition = nodeIdToNodeStakingCondition.get(nodeId);
      if (condition === undefined) {
         // TODO: log properly
         console.log(`Node ${nodeId} not found in the voter registration info`);
         continue;
      }
      condition.selfBond = BigInt(validatorInfo.selfBond);
      condition.totalStakeAmount = BigInt(validatorInfo.totalStakeAmount);
      // TODO: check if this will stay so
      condition.uptimeOk = validatorInfo.eligible;
   }

   // Checking staking conditions
   for (const [_, stakingConditionSummary] of voterToStakingConditionSummary.entries()) {
      for (const nodeCondition of stakingConditionSummary.nodeConditions) {
         if (nodeCondition.uptimeOk) {
            stakingConditionSummary.stakeWithUptime += nodeCondition.totalStakeAmount;
         }
         stakingConditionSummary.totalSelfBond += nodeCondition.selfBond;
         stakingConditionSummary.stake += nodeCondition.totalStakeAmount;
      }
      // STAKING_UPTIME_THRESHOLD_PPM (80%) of total weight must have sufficient uptime
      const uptimeOk =
         TOTAL_PPM * stakingConditionSummary.stakeWithUptime >= STAKING_UPTIME_THRESHOLD_PPM * stakingConditionSummary.stake;

      stakingConditionSummary.conditionMet = uptimeOk && stakingConditionSummary.totalSelfBond >= STAKING_MIN_SELF_BOND_GWEI;
      stakingConditionSummary.obstructsPass =
         stakingConditionSummary.totalSelfBond < STAKING_MIN_DESIRED_SELF_BOND_GWEI || stakingConditionSummary.stake < STAKING_MIN_DESIRED_STAKE_GWEI;
   }

   // Processing by voting rounds
   let totalFUUpdates = 0;
   let nonEmptyFeedValues = 0;
   for (let votingRoundId = rewardEpochInfo.signingPolicy.startVotingRoundId; votingRoundId <= rewardEpochInfo.endVotingRoundId; votingRoundId++) {
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
      for (let feedRecord of rewardCalculationData.medianCalculationResults) {
         const feedId = feedRecord.feed.id;
         if (feedRecord.data.finalMedian.isEmpty) {
            continue;
         }
         const median = feedRecord.data.finalMedian.value;
         nonEmptyFeedValues++;
         const delta = BigInt(median) * FTSO_SCALING_CLOSENESS_THRESHOLD_PPM / TOTAL_PPM;
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
   }

   // go over all data providers and check minimal conditions for fast updates
   for (const [voter, fuConditionSummary] of voterToFUConditionSummary.entries()) {
      fuConditionSummary.totalUpdatesByAll = totalFUUpdates;
      fuConditionSummary.conditionMet = fuConditionSummary.tooLowWeight ||
         TOTAL_PPM * BigInt(fuConditionSummary.updates) >= fuConditionSummary.expectedUpdatesPPM * BigInt(totalFUUpdates)
   }

   for (const [voter, ftsoScalingConditionSummary] of voterToFtsoScalingConditionSummary.entries()) {
      for (let feed of rewardEpochInfo.canonicalFeedOrder) {
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
         TOTAL_PPM * BigInt(ftsoScalingConditionSummary.totalHits) >= FTSO_SCALING_AVAILABILITY_THRESHOLD_PPM * BigInt(ftsoScalingConditionSummary.allPossibleHits);
   }

   const dataProviderConditions: DataProviderConditions[] = [];
   for (const regInfo of rewardEpochInfo.voterRegistrationInfo) {
      const voter = regInfo.voterRegistered.voter.toLowerCase();
      const ftsoScaling = voterToFtsoScalingConditionSummary.get(voter);
      const fastUpdates = voterToFUConditionSummary.get(voter);
      const staking = voterToStakingConditionSummary.get(voter);
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
      if (voterIndex === undefined) {
         throw new Error(`Voter index not found for voter ${voter}`);
      }
      const passes = voterToPassesInputData.get(voter);
      const passesHeld = passes?.passes ?? 0;
      // assemble all DataProviderConditions for each data provider
      let passEarned = false;
      if (ftsoScaling.conditionMet && fastUpdates.conditionMet && staking.conditionMet && !staking.obstructsPass) {
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

      const eligibleForReward = passesHeld - strikes >= 0;
      // Cannot go below zero
      let newNumberOfPasses = Math.max(passesHeld - strikes, 0);
      if (passEarned) {
         newNumberOfPasses++;
      }
      newNumberOfPasses = Math.min(newNumberOfPasses, MAX_NUMBER_OF_PASSES);
      const dataProviderCondition: DataProviderConditions = {
         voterAddress: voter,
         voterIndex: voterToVoterIndex.get(voter),
         passesHeld,
         passEarned,
         strikes,
         eligibleForReward,
         newNumberOfPasses,
         ftsoScaling,
         fastUpdates,
         staking
      }
      dataProviderConditions.push(dataProviderCondition);
   }

   return dataProviderConditions;
}

