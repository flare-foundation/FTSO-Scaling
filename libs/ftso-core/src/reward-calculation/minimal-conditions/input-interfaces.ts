import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { base58 } from '@scure/base';
import path from "path/posix";
import { CALCULATIONS_FOLDER, PASSES_DATA_FOLDER, STAKING_DATA_FOLDER } from "../../configs/networks";
import { DataProviderConditions } from "./minimal-conditions-interfaces";
import { bigIntReplacer } from "../../utils/big-number-serialization";

export interface Delegator {
   // pChain address, like flare123l344hlugpg0r2ntdl6fn45qyp0f5m2xakc0r
   pAddress: string;
   // cChain address, like 0x4485B10aD3ff29066938922059c5CB1e5e8Ee8b6
   cAddress: string;
   // as string in GWei   
   amount: string;
   // as string in GWei
   delegatorRewardAmount: string;
}

export interface ValidatorInfo {
   // node id in form: NodeID-2a7BPY7UeJv2njMuyUHfBSTeQCYZj6bwV
   nodeId: string;
   // bonding address in form: flare1uz66xddzplexwfdsxrzxsnlwlucyfsuax00crd
   bondingAddress: string;
   // self bond in GWei
   selfBond: string;
   // ftso address in form "0xfe532cB6Fb3C47940aeA7BeAd4d61C5e041D950e",
   ftsoAddress: string;
   // end of stake in unix time
   stakeEnd: number;
   // string of p-chain addresses (in form  flare1uz66xddzplexwfdsxrzxsnlwlucyfsuax00crd)
   pChainAddress: string[];
   // fee in GWei
   fee: number;
   // group number
   group: number;
   // is the validator eligible for staking rewards
   eligible: boolean;
   // data provider name
   ftsoName: string;
   // Boosting eligibility bond in GWei
   BEB: string;
   // Boost delegations in GWei
   boostDelegations: string;
   // boost in GWei
   boost: string;
   // self delegations in GWei
   selfDelegations: string;
   // other delegations in GWei
   normalDelegations: string;
   // total self bond in GWei
   totalSelfBond: string;
   // list of delegators
   delegators: Delegator[];
   // total stake amount in GWei“
   totalStakeAmount: string;
   // C-chain address in form of 0xaDEDCd23941E479b4736B38e271Eb926596BBe3d
   cChainAddress: string;
   // overboost in GWei
   overboost: string;
   // reward weight in GWei
   rewardingWeight: string;
   // capped weight in GWei
   cappedWeight: string;
   // node reward amount in wei
   nodeRewardAmount: string;
   // validator reward amount in wei
   validatorRewardAmount: string;
   // Node id as 20-byte hex string
   nodeId20Byte?: string;
}

export enum MinimalConditionFailureType {
   // Providers must submit a value estimate that lies within a 0.5% band around the consensus median value 
   // in 80% of voting rounds within a reward epoch.
   FTSO_SCALING_FAILURE = "FTSO_SCALING_FAILURE",
   // Providers must submit at least 80% of their expected number of updates within a reward epoch, 
   // unless they have very low weight, defined as < 0.2% of the total active weight.
   FAST_UPDATES_FAILURE = "FAST_UPDATES_FAILURE",
   // Providers must meet 80% total uptime in the reward epoch with at least 1M FLR in active self-bond. 
   // However, in order to earn passes, the provider must have at least 3M FLR in active self-bond and 15M 
   // in active stake. Providers with 80% total uptime and at least 1M FLR in active self-bond but 
   // not meeting both the 3M FLR active self-bond and 15M active stake requirements neither earn 
   // nor lose passes, and still receive eligible rewards.
   STAKING_FAILURE = "STAKING_AVAILABILITY",
}

export interface MinimalConditionFailure {
   // protocol id
   protocolId: number;
   // failure id
   failureId: MinimalConditionFailureType;
}

export interface DataProviderPasses {
   // epoch id in string
   rewardEpochId: string;
   // voter identity address in lowercase
   voterAddress: string;
   // number of passes. A number between 0 and 3
   passes: number;
   // failures
   failures?: MinimalConditionFailure[];
}

/**
 * Reads the staking info for a given reward epoch id. 
 * The data is stored in the staking data folder. 
 */
export function readStakingInfo(
   rewardEpochId: number,
   stakingDataFolder = STAKING_DATA_FOLDER()
): ValidatorInfo[] {
   const fname = path.join(stakingDataFolder, `${rewardEpochId}-nodes-data.json`);
   const data = readFileSync(fname, 'utf8');
   const result: ValidatorInfo[] = JSON.parse(data);
   for(let validatorInfo of result) {
      // "NodeID-2a7BPY7UeJv2njMuyUHfBSTeQCYZj6bwV"
      // Checksum is not validated
      validatorInfo.nodeId20Byte = "0x" + Buffer.from(base58.decode(validatorInfo.nodeId.slice(7)).subarray(0, -4)).toString("hex");
   }
   return result;
}

/**
 * Reads the passes info for a given reward epoch id.
 * The data is stored in the passes data folder.
 */
export function readPassesInfo(
   rewardEpochId: number,
   passesDataFolder = PASSES_DATA_FOLDER()
): DataProviderPasses[] | undefined {
   const fname = path.join(passesDataFolder, `${rewardEpochId}-passes-data.json`);
   if(!existsSync(fname)) {
      return undefined;
   }
   const data = readFileSync(fname, 'utf8');
   return JSON.parse(data);
}

/**
 * Writes the staking info for a given reward epoch id.
 */
export function writePassesInfo(
   rewardEpochId: number,
   data: DataProviderPasses,
   passesDataFolder = PASSES_DATA_FOLDER()
): void {
   if (!existsSync(passesDataFolder)) {
      mkdirSync(passesDataFolder, { recursive: true });
   }
   const fname = path.join(passesDataFolder, `${rewardEpochId}-passes-data.json`);
   writeFileSync(fname, JSON.stringify(data));
}

/**
 * Writes the staking info for a given reward epoch id.
 */
export function writeDataProviderConditions(
   rewardEpochId: number,
   data: DataProviderConditions[],
   calculationFolder = CALCULATIONS_FOLDER()
): void {
   if (!existsSync(calculationFolder)) {
      mkdirSync(calculationFolder, { recursive: true });
   }
   const fname = path.join(calculationFolder, `${rewardEpochId}`, `minimal-conditions.json`);
   writeFileSync(fname, JSON.stringify(data, bigIntReplacer));
}
