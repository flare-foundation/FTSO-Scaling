import { decodeLog } from "web3-eth-abi";
import { readFileSync } from "fs";
import { AbiEventFragment, AbiFunctionFragment, AbiInput } from "web3";
import { encodeEventSignature, encodeFunctionSignature } from "web3-eth-abi";
import { ContractDefinitionsNames, ContractMethodNames } from "../definitions";
import {
  InflationRewardsOffered,
  RandomAcquisitionStarted,
  RewardEpochStarted,
  RewardsOffered,
  SigningPolicyInitialized,
  SigningPolicySigned,
  VotePowerBlockSelected,
  VoterRegistered,
  VoterRegistrationInfo,
} from "../events";
import { FastUpdateFeedsSubmitted } from "../events/FastUpdateFeedsSubmitted";
import { FastUpdateFeeds } from "../events/FastUpdateFeeds";
import { FUInflationRewardsOffered } from "../events/FUInflationRewardsOffered";
import { IncentiveOffered } from "../events/IncentiveOffered";
import { AttestationRequest } from "../events/AttestationRequest";
import { FDCInflationRewardsOffered } from "../events/FDCInflationRewardsOffered";

type AbiItem = AbiFunctionFragment | AbiEventFragment;

export interface AbiData {
  abi: AbiItem;
  signature: string;
  isEvent: boolean;
}

export interface AbiDataInput {
  abi: AbiInput;
  signature: string;
}

export class AbiCache {
  // contractName => abi
  private readonly contractNameToAbi = new Map<string, AbiItem[]>();
  // contractName|functionName => abi
  private readonly contractAndNameToAbiData = new Map<string, AbiData>();

  private constructor() {
    const cachedABIs: [ContractDefinitionsNames, ContractMethodNames | undefined, string | undefined][] = [
      ["Submission", ContractMethodNames.submit1, undefined],
      ["Submission", ContractMethodNames.submit2, undefined],
      ["Submission", ContractMethodNames.submit3, undefined],
      ["Submission", ContractMethodNames.submitSignatures, undefined],
      ["FlareSystemsManager", undefined, VotePowerBlockSelected.eventName],
      ["FlareSystemsManager", undefined, RandomAcquisitionStarted.eventName],
      ["FlareSystemsManager", undefined, RewardEpochStarted.eventName],
      ["VoterRegistry", undefined, VoterRegistered.eventName],
      ["FlareSystemsCalculator", undefined, VoterRegistrationInfo.eventName],
      ["Relay", undefined, SigningPolicyInitialized.eventName],
      ["Relay", ContractMethodNames.relay, undefined],
      ["FlareSystemsManager", undefined, SigningPolicySigned.eventName],
      ["FtsoRewardOffersManager", undefined, InflationRewardsOffered.eventName],
      ["FtsoRewardOffersManager", undefined, RewardsOffered.eventName],
      ["FtsoMerkleStructs", ContractMethodNames.feedStruct, undefined],
      ["FtsoMerkleStructs", ContractMethodNames.randomStruct, undefined],
      ["FtsoMerkleStructs", ContractMethodNames.feedWithProofStruct, undefined],
      ["ProtocolMerkleStructs", ContractMethodNames.rewardClaimStruct, undefined],
      ["ProtocolMerkleStructs", ContractMethodNames.rewardClaimWithProofStruct, undefined],
      ["FastUpdater", undefined, FastUpdateFeedsSubmitted.eventName],
      ["FastUpdater", undefined, FastUpdateFeeds.eventName],
      ["FastUpdateIncentiveManager", undefined, FUInflationRewardsOffered.eventName],
      ["FastUpdateIncentiveManager", undefined, IncentiveOffered.eventName],
      ["FdcHub", undefined, AttestationRequest.eventName],
      ["FdcHub", undefined, FDCInflationRewardsOffered.eventName],
    ];

    for (const [contractName, functionName, eventName] of cachedABIs) {
      // Preload the ABIs. If something wrong, it throws exception
      this.getAbi(contractName, functionName, eventName);
    }
  }

  private static _instance: AbiCache | undefined = undefined;

  public static get instance(): AbiCache {
    if (!this._instance) {
      this._instance = new AbiCache();
    }
    return this._instance;
  }

  /**
   * Returns ABI definition for a given smart contract name and function name
   * @param contractName
   * @param functionName
   * @returns
   */
  getFunctionAbiData(contractName: string, functionName: ContractMethodNames): AbiData {
    return this.getAbi(contractName, functionName);
  }

  /**
   * Returns ABI definition for a given smart contract name and event name
   * @param contractName
   * @param eventName
   * @returns
   */
  getEventAbiData(contractName: string, eventName: string): AbiData {
    return this.getAbi(contractName, undefined, eventName);
  }

  /**
   * Returns ABI input definition for a given smart contract name, function name and function argument id
   * @param contractName
   * @param functionName
   * @param functionArgumentId
   * @returns
   */
  getFunctionInputAbiData(contractName: string, functionName: ContractMethodNames, functionArgumentId): AbiDataInput {
    return this.getAbiInput(contractName, functionName, functionArgumentId);
  }

  /**
   * Returns function signature for a given smart contract name and function name
   * @param smartContractName
   * @param functionName
   * @returns
   */
  getFunctionSignature(smartContractName: string, functionName: ContractMethodNames): string {
    return this.getFunctionAbiData(smartContractName, functionName).signature;
  }

  /**
   * Returns event signature for a given smart contract name and event name
   * @param smartContractName
   * @param eventName
   * @returns
   */
  getEventSignature(smartContractName: string, eventName: string): string {
    return this.getEventAbiData(smartContractName, eventName).signature;
  }

  /**
   * Returns relevant ABI definitions given a smart contract name and function/event name.
   * For internal use only.
   */
  private getAbi(smartContractName: string, functionName?: string, eventName?: string): AbiData {
    if ((!functionName && !eventName) || (functionName && eventName)) {
      throw new Error("Must specify either functionName or eventName");
    }
    const key = this.keyForAbiData(smartContractName, functionName, eventName);
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
    const item = contractAbi.find((x: AbiItem) => x.name === searchName)!;
    if (!item) {
      throw new Error(
        `Could not find ABI for '${smartContractName}' ${functionName ? "function" : "event"} '${searchName}'`
      );
    }
    abiData = {
      abi: item,
      isEvent: !!eventName,
      signature: functionName ? encodeFunctionSignature(item) : encodeEventSignature(item),
    };
    this.contractAndNameToAbiData.set(key, abiData);
    return abiData;
  }

  private getAbiInput(smartContractName: string, functionName: string, functionArgumentId: number): AbiDataInput {
    const abiData = this.getAbi(smartContractName, functionName);
    const abiDataInput: AbiDataInput = {
      abi: abiData.abi.inputs[functionArgumentId],
      signature: abiData.signature,
    };
    return abiDataInput;
  }

  /**
   * Returns key for cache dictionary for ABI data
   * Keys are of the form "contractName|functionName" or "contractName|eventName"
   */
  private keyForAbiData(smartContractName: string, functionName?: string, eventName?: string): string {
    return `${smartContractName}|${functionName ? functionName : eventName!}`;
  }
}

export interface RawEvent {
  readonly data: string;
  readonly topic0: string;
  readonly topic1: string;
  readonly topic2: string;
  readonly topic3: string;
}

/**
 * Decodes and transforms event @param data obtained from the indexer database,
 * for a given @param smartContractName and @param eventName into target
 * transformation type T, using @param transform function.
 */
export function decodeEvent<T>(
  smartContractName: string,
  eventName: string,
  data: RawEvent,
  transform: (data: any, entity?: RawEvent) => T
): T {
  const abiData = AbiCache.instance.getEventAbiData(smartContractName, eventName);

  function prefix0x(x: string) {
    return x.startsWith("0x") ? x : "0x" + x;
  }

  const inputs = [...abiData.abi!.inputs!];
  // Assumption: we will use it only with Solidity generated non-anonymous events from trusted contracts
  const topics = [data.topic0, data.topic1, data.topic2, data.topic3]
    .filter(x => x && x != "NULL")
    .map(x => prefix0x(x));
  const decoded = decodeLog(inputs, prefix0x(data.data), topics);
  return transform(decoded, data);
}
