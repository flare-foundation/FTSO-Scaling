import { ethers } from "ethers";
import { ContractMethodNames } from "../configs/contracts";
import { CONTRACTS } from "../configs/networks";
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
  votingRoundId?: number;
  info?: string;
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
    const claimsByBeneficiaryTypeAndSign = new Map<string, Map<number, Map<number, IPartialRewardClaim>>>();
    for (const claim of claims) {
      const beneficiary = claim.beneficiary.toLowerCase();
      const beneficiaryClaimsByTypeAndSign =
        claimsByBeneficiaryTypeAndSign.get(beneficiary) ?? new Map<number, Map<number, IPartialRewardClaim>>();
      claimsByBeneficiaryTypeAndSign.set(beneficiary, beneficiaryClaimsByTypeAndSign);
      const claimTypeBySign =
        beneficiaryClaimsByTypeAndSign.get(claim.claimType) ?? new Map<number, IPartialRewardClaim>();
      beneficiaryClaimsByTypeAndSign.set(claim.claimType, claimTypeBySign);
      const sign = claim.amount < 0n ? -1 : 1;
      let mergedClaim = claimTypeBySign.get(sign);
      if (!mergedClaim) {
        mergedClaim = {
          beneficiary,
          amount: claim.amount,
          claimType: claim.claimType,
        };
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

  /**
   * Given merged claims, where positive and negative claims are already merged separately and fully for
   * each combination of (beneficiary, claimType), the function subtracts the negative claims from the positive.
   * If a negative claim is larger (in absolute value) then the corresponding positive one, the positive
   * claim is discarded and a burn claim with value equal to the positive claim is created.
   * If a negative claim is smaller (in absolute value) then the corresponding positive one, the positive
   * is reduced for the amount of the negative claim and a burn claim with value equal to the negative claim
   * (in absolute value) is created.
   * At the end, only positive claims remain (possible 0-value claims are removed).
   * The procedure relies on the following:
   * - all claims are for the same reward epoch
   * - the sum of positive input claims matches the total amount of rewards distributed
   * - negative input claims can have any total value, even its absolute value exceeding the
   *   total amount of rewards distributed. However, negative claims are selectively subtracted
   *   from positive claims up to the value of particular positive claims. The value subtracted
   *   from positive claims converts to burn claims, which are always non-negative and direct claims
   *   to burn address.
   * - at the end all output claims are positive and the sum of positive input claims matches the sum of all
   *   output claims.
   */
  export function mergeWithBurnClaims(claims: IRewardClaim[], burnAddress: string): IRewardClaim[] {
    // beneficiary => claimType => claim
    if (claims.length === 0) {
      return [];
    }
    let initialTotalAmount = 0n;
    const rewardEpochId = claims[0].rewardEpochId;
    const negativeClaims = new Map<string, Map<Number, IRewardClaim>>();
    // assemble map of negative claims
    for (const claim of claims) {
      if (claim.rewardEpochId != rewardEpochId) {
        throw new Error("Merge with burn claims for mixed epochs");
      }
      if (claim.amount >= 0) {
        initialTotalAmount += claim.amount;
        continue;
      }
      const beneficiary = claim.beneficiary.toLowerCase();
      const beneficiaryClaimsByType = negativeClaims.get(beneficiary) || new Map<number, IRewardClaim>();
      negativeClaims.set(beneficiary, beneficiaryClaimsByType);
      if (beneficiaryClaimsByType.get(claim.claimType) !== undefined) {
        throw new Error(`Duplicate negative claim type for beneficiary ${beneficiary}`);
      }
      beneficiaryClaimsByType.set(claim.claimType, claim);
    }
    const finalClaims: IRewardClaim[] = [];
    for (const claim of claims) {
      // ignore negative claim as they are being subtracted
      const beneficiary = claim.beneficiary.toLowerCase();
      if (claim.amount <= 0) {
        continue;
      }
      const negativeClaim = negativeClaims.get(beneficiary)?.get(claim.claimType);
      if (!negativeClaim) {
        finalClaims.push(claim);
        continue;
      }

      const negativeAmount = -1n * negativeClaim.amount;
      if (negativeAmount <= 0n) {
        throw new Error(`Negative amount is not negative: ${negativeAmount}`);
      }
      if (negativeAmount > claim.amount) {
        // create full burn claim
        finalClaims.push({
          beneficiary: burnAddress,
          claimType: ClaimType.DIRECT,
          amount: claim.amount,
          rewardEpochId: claim.rewardEpochId,
        });
      } else {
        // create partial burn claim
        finalClaims.push({
          beneficiary: burnAddress,
          claimType: ClaimType.DIRECT,
          amount: negativeAmount,
          rewardEpochId: claim.rewardEpochId,
        });
        // create partial claim

        if (claim.amount - negativeAmount != 0n) {
          finalClaims.push({
            ...claim,
            amount: claim.amount - negativeAmount,
          });
        }
      }
    }
    // Perform the final merge, merging together all burn claims.
    let finalTotalAmount = 0n;
    for (let claim of finalClaims) {
      if (claim.amount <= 0) {
        throw new Error(`Negative or zero claim amount: ${claim.amount}`);
      }
      finalTotalAmount += claim.amount;
    }

    if (initialTotalAmount !== finalTotalAmount) {
      throw new Error(`Mismatch in total amount of claims: ${initialTotalAmount} !== ${finalTotalAmount}`);
    }
    const tmp = merge(finalClaims);
    const result = convertToRewardClaims(rewardEpochId, tmp);
    finalTotalAmount = 0n;
    for (let claim of tmp) {
      if (claim.amount <= 0) {
        throw new Error(`2 -Negative or zero claim amount: ${claim.amount}`);
      }
      finalTotalAmount += claim.amount;
    }

    if (initialTotalAmount !== finalTotalAmount) {
      throw new Error(`2- Mismatch in total amount of claims: ${initialTotalAmount} !== ${finalTotalAmount}`);
    }

    return result;
    // sanity check
  }
}
