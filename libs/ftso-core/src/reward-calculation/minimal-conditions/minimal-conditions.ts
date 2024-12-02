import { readStakingInfo } from "../../utils/interfacing/input-interfaces";
import { deserializeDataForRewardCalculation } from "../../utils/stat-info/reward-calculation-data";
import { deserializeRewardEpochInfo } from "../../utils/stat-info/reward-epoch-info";

const TOTAL_PPM = 1000000n;
const FTSO_SCALING_AVAILABILITY_THRESHOLD_PPM = 800000n;   // 80%
const FTSO_SCALING_CLOSENESS_THRESHOLD_PPM = 5000n;        // 0.5%
const FU_THRESHOLD_PPM = 800000n;                          // 60%
const FU_CONSIDERATION_THRESHOLD_PPM = 2000n;              // 0.2% of the weight
const STAKING_UPTIME_THRESHOLD_PPM = 800000n;              // 80%

export interface ConditionSummary {
   // whether a minimal condition is met
   conditionMet: boolean;
   // allows for a pass to be earned, if condition is met
   // if any criteria has this flag on true, the pass cannot be earned
   obstructsPass?: boolean;
}

export interface FeedHits {
   // feed id
   feedId: string;
   // out of 3360
   hits: number;
}

export interface FtsoScalingConditionSummary extends ConditionSummary {
   totalHits: number;
   feedHits: FeedHits[];
}

export interface FUConditionSummary extends ConditionSummary {
   // total updates by all providers in the reward epoch
   totalUpdatesByAll: number;
   // updates by the provider in the reward epoch
   updates: number;
   //exempt due to low weight
   tooLowWeight: boolean;
   // expected PPM share based on the share of the weight
   expectedUpdatesPPM: bigint;
}

export interface NodeStakingConditions {
   // node id as 20 byte hex string
   nodeId: string;
   // uptime sufficient
   uptimeOk: boolean;
   // self bond in GWei
   selfBond: bigint;
   // mirrored stake in GWei
   totalMirroredStake: bigint;
   // total stake amount in GWei
   totalStakeAmount: bigint;
}

export interface StakingConditionSummary extends ConditionSummary {
   // total self bond in Gwei
   totalSelfBond: bigint;
   // total stake amount in Gwei
   stake: bigint;
   // stake with uptime
   stakeWithUptime: bigint;
   // node conditions
   nodeConditions: NodeStakingConditions[];
}

export interface DataProviderConditions {
   // voter identity address
   voterAddress: string;
   // voter index
   voterIndex: number;
   // passes held
   passesHeld: number;
   // strikes
   strikes: number;
   // ftso scaling conditions
   ftsoScaling: FtsoScalingConditionSummary;
   // fast update conditions
   fastUpdates: FUConditionSummary;
   // staking conditions
   staking: StakingConditionSummary;
}

export function calculateMinimalConditions(
   rewardEpochId: number,
): DataProviderConditions[] {
   const rewardEpochInfo = deserializeRewardEpochInfo(rewardEpochId);
   const submitAddressToVoter = new Map<string, string>();
   const signingPolicyAddressToVoter = new Map<string, string>();
   const voterToVoterIndex = new Map<string, number>();
   const voterToFtsoScalingConditionSummary = new Map<string, FtsoScalingConditionSummary>();
   const voterToFUConditionSummary = new Map<string, FUConditionSummary>();
   const voterToStakingConditionSummary = new Map<string, StakingConditionSummary>();
   const nodeIdToVoter = new Map<string, string>();
   const nodeIdToNodeStakingCondition = new Map<string, NodeStakingConditions>();
   const submitAddressToFeedToHits = new Map<string, Map<string, FeedHits>>();

   const totalSigningWeight = rewardEpochInfo.signingPolicy.weights.reduce((acc, weight) => acc + weight, 0);

   for (let i = 0; i < rewardEpochInfo.voterRegistrationInfo.length; i++) {
      const voter = rewardEpochInfo.voterRegistrationInfo[i].voterRegistered.voter.toLowerCase();
      const signingWeight = rewardEpochInfo.signingPolicy.weights[i];
      const submissionAddress = rewardEpochInfo.voterRegistrationInfo[i].voterRegistered.submitAddress.toLowerCase();
      const signingPolicyAddress = rewardEpochInfo.voterRegistrationInfo[i].voterRegistered.signingPolicyAddress.toLowerCase();
      submitAddressToVoter.set(submissionAddress, voter);
      signingPolicyAddressToVoter.set(signingPolicyAddress, voter);
      voterToVoterIndex.set(voter, i);
      const ftsoScalingConditionSummary: FtsoScalingConditionSummary = {
         conditionMet: false,
         totalHits: 0,
         feedHits: [],
      }
      voterToFtsoScalingConditionSummary.set(voter, ftsoScalingConditionSummary);
      const expectedUpdatesPPM = (BigInt(signingWeight) * TOTAL_PPM) / BigInt(totalSigningWeight),
      const fuConditionSummary: FUConditionSummary = {
         conditionMet: false,
         totalUpdatesByAll: 0,
         updates: 0,
         expectedUpdatesPPM,
         tooLowWeight: expectedUpdatesPPM < FU_CONSIDERATION_THRESHOLD_PPM,
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
            hits: 0,
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
   for (const [voter, stakingConditionSummary] of voterToStakingConditionSummary.entries()) {
      for (const nodeCondition of stakingConditionSummary.nodeConditions) {
         if (nodeCondition.uptimeOk) {
            stakingConditionSummary.stakeWithUptime += nodeCondition.totalStakeAmount;
         }
         stakingConditionSummary.totalSelfBond += nodeCondition.selfBond;
         stakingConditionSummary.stake += nodeCondition.totalStakeAmount;
      }
      // STAKING_UPTIME_THRESHOLD_PPM (80%) of total weight must have sufficient uptime
      stakingConditionSummary.conditionMet =
         TOTAL_PPM * stakingConditionSummary.stakeWithUptime >= STAKING_UPTIME_THRESHOLD_PPM * stakingConditionSummary.stake;
   }

   // Processing by voting rounds
   let totalFUUpdates = 0;
   for (let votingRoundId = rewardEpochInfo.signingPolicy.startVotingRoundId; votingRoundId <= rewardEpochInfo.endVotingRoundId; votingRoundId++) {
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
         const delta = BigInt(median) * FTSO_SCALING_CLOSENESS_THRESHOLD_PPM / TOTAL_PPM;
         const low = median - Number(delta);
         const high = median + Number(delta);

         if (feedRecord.feedValues.length !== feedRecord.votersSubmitAddresses.length) {
            // sanity check
            throw new Error(`Feed values and voters submit addresses length mismatch for feed ${feedId}`);
         }
         for (let i = 0; i < feedRecord.feedValues.length; i++) {
            // TODO: write logic
         }
      }
   }

   // TODO: go over all data providers and check minimal conditions for fast updates
   for (const [voter, fuConditionSummary] of voterToFUConditionSummary.entries()) {
      fuConditionSummary.totalUpdatesByAll = totalFUUpdates;
      fuConditionSummary.conditionMet = TOTAL_PPM * BigInt(fuConditionSummary.updates) >= FU_THRESHOLD_PPM * BigInt(totalFUUpdates);
   }

   // TODO: go over all data providers and check minimal conditions for ftso scaling

   // TODO: assemble all DataProviderConditions for each data provider
}

