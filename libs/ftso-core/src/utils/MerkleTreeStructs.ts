import { ethers } from "ethers";
import { EncodingUtils } from "./EncodingUtils";
import { CONTRACTS } from "../configs/networks";
import { MedianCalculationResult, RandomCalculationResult } from "../voting-types";
const coder = ethers.AbiCoder.defaultAbiCoder();

export interface FeedResult {
   votingRoundId: number;
   name: string;
   value: number;
   turnoutBIPS: number;
   decimals: number;
}

export interface RandomResult {
   votingRoundId: number;
   value: string;  // 0x-prefixed bytes32 encoded uint256
   isSecure: boolean;
}

export namespace MerkleTreeStructs {
   export function hashPriceFeedResult(feedResult: FeedResult): string {
      const abiInput = EncodingUtils.instance.getFunctionInputAbiData(CONTRACTS.FtsoMerkleStructs.name, "feedStruct", 0);
      const abiEncoded = coder.encode([abiInput.abi as any], [feedResult]);
      return ethers.keccak256(abiEncoded);
   }

   export function hashRandomResult(randomResult: RandomResult): string {
      const abiInput = EncodingUtils.instance.getFunctionInputAbiData(CONTRACTS.FtsoMerkleStructs.name, "randomStruct", 0);
      const abiEncoded = coder.encode([abiInput.abi as any], [randomResult]);
      return ethers.keccak256(abiEncoded);
   }

   export function fromMedianCalculationResult(medianCalculationResult: MedianCalculationResult): FeedResult {
      return {
         votingRoundId: medianCalculationResult.votingRoundId,
         name: medianCalculationResult.feed.name,
         value: medianCalculationResult.data.finalMedianPrice.value,
         turnoutBIPS: Number((medianCalculationResult.data.participatingWeight * 10000n)/medianCalculationResult.totalVotingWeight),
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
      return hashPriceFeedResult(fromMedianCalculationResult(medianCalculationResult));
   }

   export function hashRandomCalculationResult(randomCalculationResult: RandomCalculationResult): string {
      return hashRandomResult(fromRandomCalculationResult(randomCalculationResult));
   }
}


