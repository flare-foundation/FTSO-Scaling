import { readFileSync } from "fs";
import { AbiItem } from "web3-utils/types";
import { AbiCoder } from "web3-eth-abi";
import { CONTRACTS } from "../configs/networks";
import {
  VotePowerBlockSelected,
  RandomAcquisitionStarted,
  RewardEpochStarted,
  VoterRegistered,
  VoterRegistrationInfo,
  SigningPolicyInitialized,
  InflationRewardsOffered,
  RewardsOffered,
} from "../events";

export interface AbiData {
  abi: AbiItem;
  signature: string;
  isEvent: boolean;
}

export class ABICache {
  // contractName => abi
  readonly contractNameToAbi = new Map<string, AbiItem[]>();
  // contractName|functionName => abi
  readonly contractAndNameToAbiData = new Map<string, AbiData>();

  constructor(private readonly coder: AbiCoder) {
    // Cache the following ABIs
    const cachedABIs: [string, string | undefined, string | undefined][] = [
      [CONTRACTS.Submission.name, "submit1", undefined],
      [CONTRACTS.Submission.name, "submit2", undefined],
      [CONTRACTS.Submission.name, "submit3", undefined],
      [CONTRACTS.Submission.name, "submitSignatures", undefined],
      [CONTRACTS.FlareSystemManager.name, undefined, VotePowerBlockSelected.eventName],
      [CONTRACTS.FlareSystemManager.name, undefined, RandomAcquisitionStarted.eventName], //  "RandomAcquisitionStarted"],
      [CONTRACTS.FlareSystemManager.name, undefined, RewardEpochStarted.eventName],
      [CONTRACTS.VoterRegistry.name, undefined, VoterRegistered.eventName],
      [CONTRACTS.FlareSystemCalculator.name, undefined, VoterRegistrationInfo.eventName],
      [CONTRACTS.Relay.name, undefined, SigningPolicyInitialized.eventName],
      [CONTRACTS.FlareSystemManager.name, undefined, "SigningPolicySigned"],
      [CONTRACTS.FtsoRewardOffersManager.name, undefined, InflationRewardsOffered.eventName],
      [CONTRACTS.FtsoRewardOffersManager.name, undefined, RewardsOffered.eventName],
    ];

    for (const [contractName, functionName, eventName] of cachedABIs) {
      // Preload the ABIs. If something wrong, it throws exception
      this.getAbi(contractName, functionName, eventName);
    }
  }

  /**
   * Returns relevant ABI definitions given a smart contract name and function/event name.
   * For internal use only.
   */
  getAbi(smartContractName: string, functionName?: string, eventName?: string): AbiData {
    if ((!functionName && !eventName) || (functionName && eventName)) {
      throw new Error("Must specify either functionName or eventName");
    }
    let key = this.keyForAbiData(smartContractName, functionName, eventName);
    let abiData = this.contractAndNameToAbiData.get(key);
    if (abiData) return abiData;
    let contractAbi = this.contractNameToAbi.get(smartContractName);
    if (!contractAbi) {
      try {
        contractAbi = JSON.parse(readFileSync(`abi/${smartContractName}.json`).toString()).abi as AbiItem[];
      } catch (e) {
        throw new Error(`Could not load ABI for ${smartContractName}`);
      }
      this.contractNameToAbi.set(smartContractName, contractAbi);
    }

    const searchName = functionName ? functionName : eventName!;
    let item = contractAbi.find((x: AbiItem) => x.name === searchName)!;
    if (!item) {
      throw new Error(
        `Could not find ABI for '${smartContractName}' ${functionName ? "function" : "event"} '${searchName}'`
      );
    }
    abiData = {
      abi: item,
      isEvent: !!eventName,
      signature: functionName ? this.coder.encodeFunctionSignature(item) : this.coder.encodeEventSignature(item),
    } as AbiData;
    this.contractAndNameToAbiData.set(key, abiData);
    return abiData;
  }

  /**
   * Returns key for cache dictionary for ABI data
   * Keys are of the form "contractName|functionName" or "contractName|eventName"
   */
  private keyForAbiData(smartContractName: string, functionName?: string, eventName?: string): string {
    return `${smartContractName}|${functionName ? functionName : eventName!}`;
  }
}
