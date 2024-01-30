import { ethers } from "ethers";
import { CONTRACTS, ContractMethodNames } from "../configs/networks";
import { EncodingUtils } from "./EncodingUtils";
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

export interface IPartialRewardClaim {
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
    const abiInput = EncodingUtils.instance.getFunctionInputAbiData(
      CONTRACTS.ProtocolMerkleStructs.name,
      ContractMethodNames.rewardClaimStruct,
      0
    );
    const abiEncoded = coder.encode([abiInput.abi as any], [rewardClaim]);
    return ethers.keccak256(abiEncoded);
  }

  /**
   * Merges a list of claims.
   * All claims of the same beneficiary and type are merged into a single claim whose
   * amount is the sum of the amounts of the merged claims.
   * @param IRewardClaim
   * @returns
   */
  export function merge(claims: IPartialRewardClaim[]): IPartialRewardClaim[] {
    const claimsByBeneficiaryAndType = new Map<string, Map<number, IPartialRewardClaim>>();
    for (const claim of claims) {
      const beneficiary = claim.beneficiary.toLowerCase();
      const beneficiaryClaimsByType = claimsByBeneficiaryAndType.get(beneficiary) || new Map<number, IRewardClaim>();
      claimsByBeneficiaryAndType.set(claim.beneficiary, beneficiaryClaimsByType);
      let mergedClaim = beneficiaryClaimsByType.get(claim.claimType);
      if (!mergedClaim) {
        mergedClaim = { ...claim, beneficiary };
      } else {
        mergedClaim.amount += claim.amount;
      }
    }
    const mergedClaims: IPartialRewardClaim[] = [];
    for (const beneficiaryClaimsByType of claimsByBeneficiaryAndType.values()) {
      for (const mergedClaim of beneficiaryClaimsByType.values()) {
        mergedClaims.push(mergedClaim);
      }
    }
    return mergedClaims;
  }

  /**
   * Converts a list of IPartialRewardClaim to IRewardClaim.
   * @param rewardEpochId
   * @param claims
   * @returns
   */
  export function convertToRewardClaims(rewardEpochId: number, claims: IPartialRewardClaim[]): IRewardClaim[] {
    return claims.map(claim => {
      return {
        rewardEpochId,
        beneficiary: claim.beneficiary,
        amount: claim.amount,
        claimType: claim.claimType,
      };
    });
  }
}
