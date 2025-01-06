import { ethers } from "ethers";
import { ContractMethodNames } from "../../../contracts/src/definitions";
import { MedianCalculationResult, RandomCalculationResult } from "../voting-types";

import {AbiCache} from "../../../contracts/src/abi/AbiCache";
import {CONTRACTS} from "../../../contracts/src/constants";
const coder = ethers.AbiCoder.defaultAbiCoder();

// Needs to be kept in sync with IFtsoFeedPublisher.Feed struct in smart contracts
export interface FeedResult {
  readonly votingRoundId: number;
  readonly id: string; // Needs to be 0x-prefixed for abi encoding
  readonly value: number;
  readonly turnoutBIPS: number;
  readonly decimals: number;
}

export interface RandomResult {
  readonly votingRoundId: number;
  readonly value: string; // 0x-prefixed bytes32 encoded uint256
  readonly isSecure: boolean;
}

export type TreeResult = FeedResult | RandomResult;

export namespace MerkleTreeStructs {
  export function hashFeedResult(feedResult: FeedResult): string {
    const abiInput = AbiCache.instance.getFunctionInputAbiData(
      CONTRACTS.FtsoMerkleStructs.name,
      ContractMethodNames.feedStruct,
      0
    );
    const abiEncoded = coder.encode([abiInput.abi as any], [feedResult]);
    return ethers.keccak256(abiEncoded);
  }

  export function hashRandomResult(randomResult: RandomResult): string {
    const abiInput = AbiCache.instance.getFunctionInputAbiData(
      CONTRACTS.FtsoMerkleStructs.name,
      ContractMethodNames.randomStruct,
      0
    );
    const abiEncoded = coder.encode([abiInput.abi as any], [randomResult]);
    return ethers.keccak256(abiEncoded);
  }

  export function fromMedianCalculationResult(medianCalculationResult: MedianCalculationResult): FeedResult {
    return {
      votingRoundId: medianCalculationResult.votingRoundId,
      id: medianCalculationResult.feed.id.startsWith("0x")
        ? medianCalculationResult.feed.id
        : "0x" + medianCalculationResult.feed.id,
      value: medianCalculationResult.data.finalMedian.value,
      turnoutBIPS: Number(
        (medianCalculationResult.data.participatingWeight * 10000n) / medianCalculationResult.totalVotingWeight
      ),
      decimals: medianCalculationResult.feed.decimals,
    };
  }

  export function fromRandomCalculationResult(randomCalculationResult: RandomCalculationResult): RandomResult {
    return {
      votingRoundId: randomCalculationResult.votingRoundId,
      value: "0x" + randomCalculationResult.random.toString(16),
      isSecure: randomCalculationResult.isSecure,
    };
  }

  export function hashMedianCalculationResult(medianCalculationResult: MedianCalculationResult): string {
    return hashFeedResult(fromMedianCalculationResult(medianCalculationResult));
  }

  export function hashRandomCalculationResult(randomCalculationResult: RandomCalculationResult): string {
    return hashRandomResult(fromRandomCalculationResult(randomCalculationResult));
  }
}

// User facing API response feed with proof
export interface FeedResultWithProof {
  body: FeedResult;
  proof: string[];
}
