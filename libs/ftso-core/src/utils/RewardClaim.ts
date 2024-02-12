import { ethers } from "ethers";
import { CONTRACTS } from "../configs/networks";
import { ContractMethodNames } from "../configs/contracts";
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
  claimType: ClaimType;
}

export interface IPartialRewardClaim {
  beneficiary: string;
  amount: bigint;
  claimType: ClaimType;
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
    // beneficiary => claimType => sign => claim
    const claimsByBeneficiaryTypeAndSign = new Map<string, Map<number, Map<Number, IPartialRewardClaim>>>();
    for (const claim of claims) {
      const beneficiary = claim.beneficiary.toLowerCase();
      const beneficiaryClaimsByTypeAndSign =
        claimsByBeneficiaryTypeAndSign.get(beneficiary) || new Map<number, Map<number, IRewardClaim>>();
      claimsByBeneficiaryTypeAndSign.set(claim.beneficiary, beneficiaryClaimsByTypeAndSign);
      const claimTypeBySign = beneficiaryClaimsByTypeAndSign.get(claim.claimType) || new Map<number, IRewardClaim>();
      beneficiaryClaimsByTypeAndSign.set(claim.claimType, claimTypeBySign);
      const sign = claim.amount < 0 ? -1 : 1;
      let mergedClaim = claimTypeBySign.get(sign);
      if (!mergedClaim) {
        mergedClaim = { ...claim, beneficiary };
        claimTypeBySign.set(sign, mergedClaim);
      } else {
        mergedClaim.amount += claim.amount;
      }
    }
    const mergedClaims: IPartialRewardClaim[] = [];

    for (const beneficiaryClaimsByType of claimsByBeneficiaryTypeAndSign.values()) {
      for (const signToClaims of beneficiaryClaimsByType.values()) {
        for (const mergedClaim of signToClaims.values()) {
          mergedClaims.push(mergedClaim);
        }
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
        ...claim,
        rewardEpochId,
      };
    });
  }
}
