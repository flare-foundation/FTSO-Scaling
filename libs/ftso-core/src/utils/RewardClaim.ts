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

export interface IMergeableRewardClaim {
  beneficiary: string;
  amount: bigint;
  claimType: ClaimType;
}
export interface IRewardClaim extends IMergeableRewardClaim {
  rewardEpochId: number;
}

export interface IPartialRewardClaim extends IMergeableRewardClaim {
  votingRoundId?: number;
  info?: string;
  offerIndex?: number;
  feedId?: string;
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
  export function merge(claims: IMergeableRewardClaim[]): IMergeableRewardClaim[] {
    // beneficiary => claimType => sign => claim
    const claimsByBeneficiaryTypeAndSign = new Map<string, Map<number, Map<number, IMergeableRewardClaim>>>();
    for (const claim of claims) {
      const beneficiary = claim.beneficiary.toLowerCase();
      const beneficiaryClaimsByTypeAndSign =
        claimsByBeneficiaryTypeAndSign.get(beneficiary) ?? new Map<number, Map<number, IMergeableRewardClaim>>();
      claimsByBeneficiaryTypeAndSign.set(beneficiary, beneficiaryClaimsByTypeAndSign);
      const claimTypeBySign =
        beneficiaryClaimsByTypeAndSign.get(claim.claimType) ?? new Map<number, IMergeableRewardClaim>();
      beneficiaryClaimsByTypeAndSign.set(claim.claimType, claimTypeBySign);
      const sign = claim.amount < 0n ? -1 : 1;
      let mergedClaim = claimTypeBySign.get(sign);
      if (typeof claim.amount !== "bigint") {
        throw new Error(`Claim amount is not a "bigint": ${claim}`);
      }
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
    const mergedClaims: IMergeableRewardClaim[] = [];

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
   * Converts a list of IMergeableRewardClaim to IRewardClaim.
   * @param rewardEpochId
   * @param claims
   * @returns
   */
  export function convertToRewardClaims(rewardEpochId: number, claims: IMergeableRewardClaim[]): IRewardClaim[] {
    return claims.map(claim => {
      return {
        beneficiary: claim.beneficiary.toLowerCase(),
        claimType: claim.claimType,
        amount: claim.amount,
        rewardEpochId,
      };
    });
  }

  /**
   * Compares whether two lists of reward claims contain equal claims. They have
   * to have the same length and the same claims in the same order.
   * Lists are first sorted by beneficiary and then by claim type.
   */
  export function compareRewardClaims(claims1: IRewardClaim[], claims2: IRewardClaim[]): boolean {
    if (claims1.length !== claims2.length) {
      return false;
    }
    const sortFunc = (a, b) => {
      if (a.beneficiary < b.beneficiary) {
        return -1;
      }
      if (a.beneficiary > b.beneficiary) {
        return 1;
      }
      if (a.claimType < b.claimType) {
        return -1;
      }
      if (a.claimType > b.claimType) {
        return 1;
      }
      return 0;
    };

    const claimsInternal1 = [...claims1];
    const claimsInternal2 = [...claims2];
    claimsInternal1.sort(sortFunc);
    claimsInternal2.sort(sortFunc);

    for (let i = 0; i < claims1.length; i++) {
      const claim1 = claimsInternal1[i];
      const claim2 = claimsInternal2[i];
      if (claim1.beneficiary !== claim2.beneficiary) {
        return false;
      }
      if (claim1.claimType !== claim2.claimType) {
        return false;
      }
      if (claim1.amount !== claim2.amount) {
        return false;
      }
    }
    return true;
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
    const negativeClaims = new Map<string, Map<number, IRewardClaim>>();
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
    for (const claim of finalClaims) {
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
    for (const claim of tmp) {
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
