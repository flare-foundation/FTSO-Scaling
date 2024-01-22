import { ethers } from "ethers";
import { EncodingUtils } from "./EncodingUtils";
import { CONTRACTS } from "../configs/networks";
const coder = ethers.AbiCoder.defaultAbiCoder();

export enum ClaimType {
   DIRECT,
   FEE,
   WNAT,
   MIRROR,
   CCHAIN,
}

/**
 * RewardClaim type matching the Solidity struct for reward claim of the form:
 * 
 * struct RewardClaim {
 *   uint24 rewardEpochId;
 *   bytes20 beneficiary; // c-chain address or node id (bytes20) in case of type MIRROR
 *   uint120 amount; // in wei
 *   ClaimType claimType;
 * }
 * 
 * where ClaimType is an enum:   
 * enum ClaimType { DIRECT, FEE, WNAT, MIRROR, CCHAIN } 
 */
export interface IRewardClaim {
   rewardEpochId: number;
   beneficiary: string;
   amount: bigint;
   claimType: number;
}

/**
 * RewardClaimWithProof type matching the Solidity struct for reward claim with proof of the form:
 * 
 * struct RewardClaimWithProof {
 *  bytes32[] merkleProof;
 *  RewardClaim body;
 * }
 */
export interface IRewardClaimWithProof {
   merkleProof: string[];
   body: IRewardClaim;
}

export namespace RewardClaim {
   export function hashRewardClaim(rewardClaim: IRewardClaim): string {
      const abiInput = EncodingUtils.instance.getFunctionInputAbiData(CONTRACTS.ProtocolMerkleStructs.name, "rewardClaimStruct", 0);
      const abiEncoded = coder.encode([abiInput.abi as any], [rewardClaim]);
      return ethers.keccak256(abiEncoded);
   }


}
