import { BURN_ADDRESS } from "../../libs/ftso-core/src/configs/networks";
import { RewardOffers } from "../../libs/ftso-core/src/events";
import { RewardTypePrefix } from "../../libs/ftso-core/src/reward-calculation/RewardTypePrefix";
import { ILogger, emptyLogger } from "../../libs/ftso-core/src/utils/ILogger";
import { ClaimType, IPartialRewardClaim, IRewardClaim } from "../../libs/ftso-core/src/utils/RewardClaim";
import { TestVoter } from "./basic-generators";

function claimListSummary(beneficiary: string, voterIndex: number, type: "node" | "delegation" | "signing" | "identity" | "none", claims: IRewardClaim[], padding = 6) {
  const feeClaim = claims.find(c => c.claimType === ClaimType.FEE);
  const fee = (feeClaim ? Number(feeClaim.amount) : 0).toString().padStart(padding);
  const wnatClaim = claims.find(c => c.claimType === ClaimType.WNAT);
  const wnat = (wnatClaim ? Number(wnatClaim.amount) : 0).toString().padStart(padding);
  const mirrorClaim = claims.find(c => c.claimType === ClaimType.MIRROR);
  const mirror = (mirrorClaim ? Number(mirrorClaim.amount) : 0).toString().padStart(padding);
  const directClaim = claims.find(c => c.claimType === ClaimType.DIRECT);
  const direct = (directClaim ? Number(directClaim.amount) : 0).toString().padStart(padding);
  const cchainClaim = claims.find(c => c.claimType === ClaimType.CCHAIN);
  const cchain = (cchainClaim ? Number(cchainClaim.amount) : 0).toString().padStart(padding);

  let indexValue = "-";
  if (type === "node") {
    indexValue = "n-" + voterIndex.toString();
  } else if (type === "delegation") {
    indexValue = "d-" + voterIndex.toString();
  } else if (type === "signing") {
    indexValue = "s-" + voterIndex.toString();
  } else if (type === "identity") {
    indexValue = "i-" + voterIndex.toString();
  }
  let addressText = beneficiary.slice(0, 10);
  if (beneficiary.toLowerCase() === BURN_ADDRESS.toLowerCase()) {
    addressText = "BURN ADDR ";
  }
  return `${indexValue.padStart(5)} ${addressText}: FEE: ${fee}|  WNAT: ${wnat}|  MIRROR: ${mirror}|  DIRECT: ${direct}|  CCHAIN: ${cchain}`;
}

export interface VoterClaimSummary {
  voter?: TestVoter;
  voterIndex?: number;
  externalVoter?: string;
  medianFees: IPartialRewardClaim[];
  medianDelegationRewards: IPartialRewardClaim[];
  signingFees: IPartialRewardClaim[];
  signingDelegationRewards: IPartialRewardClaim[];
  signingNodeIdRewards: IPartialRewardClaim[];
  finalizationFees: IPartialRewardClaim[];
  finalizationDelegationRewards: IPartialRewardClaim[];
  finalizationNodeIdRewards: IPartialRewardClaim[];
  doubleSigningFeePenalties: IPartialRewardClaim[];
  doubleSigningDelegationPenalties: IPartialRewardClaim[];
  doubleSigningNodeIdPenalties: IPartialRewardClaim[];
  revealWithdrawalFeePenalties: IPartialRewardClaim[];
  revealWithdrawalDelegationPenalties: IPartialRewardClaim[];
  revealWithdrawalNodeIdPenalties: IPartialRewardClaim[];
  directClaims: IPartialRewardClaim[];
}

function initializeEmptyVoterClaimSummary(): VoterClaimSummary {
  return {
    medianFees: [],
    medianDelegationRewards: [],
    signingFees: [],
    signingDelegationRewards: [],
    signingNodeIdRewards: [],
    finalizationFees: [],
    finalizationDelegationRewards: [],
    finalizationNodeIdRewards: [],
    doubleSigningFeePenalties: [],
    doubleSigningDelegationPenalties: [],
    doubleSigningNodeIdPenalties: [],
    revealWithdrawalFeePenalties: [],
    revealWithdrawalDelegationPenalties: [],
    revealWithdrawalNodeIdPenalties: [],
    directClaims: []
  };
}

export function calculateVoterClaimSummaries(voters: TestVoter[], claims: IPartialRewardClaim[]): VoterClaimSummary[] {
  const nodeIdToVoterIndex = new Map<string, number>();
  const signingAddressToVoterIndex = new Map<string, number>();
  const delegationAddressToVoterIndex = new Map<string, number>();
  const identityAddressToVoterIndex = new Map<string, number>();
  const voterIndexToSummary = new Map<number, VoterClaimSummary>();
  const externalAddressToSummary = new Map<string, VoterClaimSummary>();

  for (let i = 0; i < voters.length; i++) {
    const voter = voters[i];
    for (const nodeId of voter.nodeIds) {
      nodeIdToVoterIndex.set(nodeId, i);
    }
    signingAddressToVoterIndex.set(voter.signingAddress.toLowerCase(), i);
    identityAddressToVoterIndex.set(voter.identityAddress.toLowerCase(), i);
    delegationAddressToVoterIndex.set(voter.delegationAddress.toLowerCase(), i);
    const voterSummary = initializeEmptyVoterClaimSummary();
    voterSummary.voter = voter;
    voterSummary.voterIndex = i;
    voterIndexToSummary.set(i, voterSummary);
  }

  for (let claim of claims) {
    const isVoterClaim = false;
    const beneficiary = claim.beneficiary.toLowerCase();
    let voterIndex = identityAddressToVoterIndex.get(beneficiary);
    if (voterIndex !== undefined) {
      // should be fee of direct claim from external voter
      if (claim.claimType === ClaimType.FEE) {
        if (claim.info.startsWith(RewardTypePrefix.MEDIAN)) {
          voterIndexToSummary.get(voterIndex).medianFees.push(claim);
          continue;
        } else if (claim.info.startsWith(RewardTypePrefix.SIGNING)) {
          voterIndexToSummary.get(voterIndex).signingFees.push(claim);
          continue;
        } else if (claim.info.startsWith(RewardTypePrefix.FINALIZATION)) {
          voterIndexToSummary.get(voterIndex).finalizationFees.push(claim);
          continue;
        } else if (claim.info.startsWith(RewardTypePrefix.DOUBLE_SIGNERS)) {
          voterIndexToSummary.get(voterIndex).doubleSigningFeePenalties.push(claim);
          continue;
        } else if (claim.info.startsWith(RewardTypePrefix.REVEAL_OFFENDERS)) {
          voterIndexToSummary.get(voterIndex).revealWithdrawalFeePenalties.push(claim);
          continue;
        } else {
          throw new Error(`Unknown claim info: ${claim.info}, identityAddress: ${beneficiary}, voterIndex: ${voterIndex}`);
        }
      } else if (claim.claimType === ClaimType.DIRECT) {
        let summary = externalAddressToSummary.get(beneficiary) || initializeEmptyVoterClaimSummary();
        summary.directClaims.push(claim);
        summary.externalVoter = beneficiary;
        externalAddressToSummary.set(beneficiary, summary);
        continue;
      } else {
        throw new Error(`Invalid claim type ${claim.claimType} for identity address: ${claim.claimType}, voterIndex: ${voterIndex}`);
      }
    }
    voterIndex = delegationAddressToVoterIndex.get(beneficiary);
    if (voterIndex !== undefined) {
      if (claim.info.startsWith(RewardTypePrefix.MEDIAN)) {
        voterIndexToSummary.get(voterIndex).medianDelegationRewards.push(claim);
        continue;
      } else if (claim.info.startsWith(RewardTypePrefix.SIGNING)) {
        voterIndexToSummary.get(voterIndex).signingDelegationRewards.push(claim);
        continue;
      } else if (claim.info.startsWith(RewardTypePrefix.FINALIZATION)) {
        voterIndexToSummary.get(voterIndex).finalizationDelegationRewards.push(claim);
        continue;
      } else if (claim.info.startsWith(RewardTypePrefix.DOUBLE_SIGNERS)) {
        voterIndexToSummary.get(voterIndex).doubleSigningDelegationPenalties.push(claim);
        continue;
      } else if (claim.info.startsWith(RewardTypePrefix.REVEAL_OFFENDERS)) {
        voterIndexToSummary.get(voterIndex).revealWithdrawalDelegationPenalties.push(claim);
        continue;
      } else {
        throw new Error(`Unknown claim info: ${claim.info}, delegationAddress: ${beneficiary}, voterIndex: ${voterIndex}`);
      }
    }
    voterIndex = nodeIdToVoterIndex.get(beneficiary);
    if (voterIndex !== undefined) {
      if (claim.info.startsWith(RewardTypePrefix.SIGNING)) {
        voterIndexToSummary.get(voterIndex).signingNodeIdRewards.push(claim);
        continue;
      } else if (claim.info.startsWith(RewardTypePrefix.FINALIZATION)) {
        voterIndexToSummary.get(voterIndex).finalizationNodeIdRewards.push(claim);
        continue;
      } else if (claim.info.startsWith(RewardTypePrefix.DOUBLE_SIGNERS)) {
        voterIndexToSummary.get(voterIndex).doubleSigningNodeIdPenalties.push(claim);
        continue;
      } else if (claim.info.startsWith(RewardTypePrefix.REVEAL_OFFENDERS)) {
        voterIndexToSummary.get(voterIndex).revealWithdrawalNodeIdPenalties.push(claim);
        continue;
      } else {
        throw new Error(`Unknown claim info: ${claim.info}, nodeId: ${beneficiary}, voterIndex: ${voterIndex}`);
      }
    }
    voterIndex = signingAddressToVoterIndex.get(beneficiary);
    if (voterIndex !== undefined) {
      if (claim.claimType === ClaimType.DIRECT) {
        voterIndexToSummary.get(voterIndex).directClaims.push(claim);
        continue;
      }
      throw new Error(`Unknown claim info: ${claim.info}, signingAddress: ${beneficiary}, voterIndex: ${voterIndex}`);
    }

    if(claim.claimType !== ClaimType.DIRECT) {
      throw new Error(`Unknown claim info: ${claim.info}, beneficiary: ${beneficiary} not a voter, but claim is not DIRECT`);
    }
    // DIRECT claim by external voter
    const summary = externalAddressToSummary.get(beneficiary) || initializeEmptyVoterClaimSummary();
    summary.directClaims.push(claim);
    summary.externalVoter = beneficiary;
    externalAddressToSummary.set(beneficiary, summary);
  } // for claim of claims

  const result: VoterClaimSummary[] = [];
  for (let i = 0; i < voters.length; i++) {
    result.push(voterIndexToSummary.get(i));
  }
  for (let summary of externalAddressToSummary.values()) {
    result.push(summary);
  }
  return result;
}
/**
 * Calculates and possibly prints out the summary of the rewards per voter 
 */
export function claimSummary(voters: TestVoter[], claims: IRewardClaim[], logger: ILogger = emptyLogger) {
  const voterToClaimMap = new Map<string, IRewardClaim[]>();
  const nodeIdToVoterIndex = new Map<string, number>();
  const signingAddressToVoterIndex = new Map<string, number>();
  const delegationAddressToVoterIndex = new Map<string, number>();
  const identityAddressToVoterIndex = new Map<string, number>();
  const voterIndexToFees = new Map<number, bigint>();
  const voterIndexToParticipationRewards = new Map<number, bigint>();

  for (let i = 0; i < voters.length; i++) {
    const voter = voters[i];
    for (const nodeId of voter.nodeIds) {
      nodeIdToVoterIndex.set(nodeId, i);
    }
    signingAddressToVoterIndex.set(voter.signingAddress.toLowerCase(), i);
    identityAddressToVoterIndex.set(voter.identityAddress.toLowerCase(), i);
    delegationAddressToVoterIndex.set(voter.delegationAddress.toLowerCase(), i);
  }
  let totalValue = 0n;
  let burned = 0n;
  const unusedBeneficiaries = new Set<string>();
  for (const claim of claims) {
    totalValue += claim.amount;
    const beneficiary = claim.beneficiary.toLowerCase();
    unusedBeneficiaries.add(beneficiary);
    if (beneficiary.toLowerCase() === BURN_ADDRESS.toLowerCase()) {
      burned += claim.amount;
    }
    const claimList = voterToClaimMap.get(beneficiary) || [];
    claimList.push(claim);
    voterToClaimMap.set(beneficiary, claimList);
  }
  const allVoters = new Set<string>();
  for (const voter of voters) {
    allVoters.add(voter.identityAddress.toLowerCase());
  }
  const nonVoterAddresses = new Set<string>();
  for (const claim of claims) {
    const beneficiary = claim.beneficiary.toLowerCase();
    if (!allVoters.has(beneficiary)) {
      nonVoterAddresses.add(beneficiary);
    }
  }
  logger.log("CLAIM SUMMARY");
  logger.log("Total value: ", totalValue.toString());
  logger.log("Burned value:", burned.toString());
  logger.log("VOTER FEES (by identity address):");
  for (let i = 0; i < voters.length; i++) {
    const voter = voters[i];
    const address = voter.identityAddress.toLowerCase();
    unusedBeneficiaries.delete(address);
    const claimList = voterToClaimMap.get(address) || [];
    if (claimList.length > 0) {
      logger.log(claimListSummary(address, i, "identity", claimList));
    }
  }
  logger.log("DELEGATION REWARDS");
  for (let i = 0; i < voters.length; i++) {
    const voter = voters[i];
    const address = voter.delegationAddress.toLowerCase();
    unusedBeneficiaries.delete(address);
    const claimList = voterToClaimMap.get(address) || [];
    if (claimList.length > 0) {
      logger.log(claimListSummary(address, i, "delegation", claimList));
    }
  }
  logger.log("STAKING REWARDS");
  for (let i = 0; i < voters.length; i++) {
    const voter = voters[i];
    for (let nodeId of voter.nodeIds) {
      unusedBeneficiaries.delete(nodeId);
      const claimList = voterToClaimMap.get(nodeId) || [];
      if (claimList.length > 0) {
        logger.log(claimListSummary(nodeId, i, "node", claimList));
      }
    }
  }

  logger.log("SIGNING ADDRESS REWARDS");
  for (let i = 0; i < voters.length; i++) {
    const voter = voters[i];
    const address = voter.signingAddress.toLowerCase();
    unusedBeneficiaries.delete(address);
    const claimList = voterToClaimMap.get(address) || [];
    if (claimList.length > 0) {
      logger.log(claimListSummary(address, i, "signing", claimList));
    }
  }

  logger.log("DIRECT CLAIMS");
  if (unusedBeneficiaries.size === 0) {
    logger.log("-----");
  }
  for (const beneficiary of unusedBeneficiaries) {
    const claimList = voterToClaimMap.get(beneficiary) || [];
    if (claimList.length > 0) {
      logger.log(claimListSummary(beneficiary, -1, "none", claimList));
    }
  }

  for (const claim of claims) {
    if (claim.claimType === ClaimType.DIRECT) {
      continue;
    }
    if (claim.claimType === ClaimType.CCHAIN) {
      throw new Error(`Unsupported claim type: ${claim.claimType}`);
    }
    let voterIndex: number | undefined;
    if (identityAddressToVoterIndex.get(claim.beneficiary) !== undefined) {
      voterIndex = identityAddressToVoterIndex.get(claim.beneficiary);
    } else if (delegationAddressToVoterIndex.get(claim.beneficiary) !== undefined) {
      voterIndex = delegationAddressToVoterIndex.get(claim.beneficiary);
    } else if (nodeIdToVoterIndex.get(claim.beneficiary) !== undefined) {
      voterIndex = nodeIdToVoterIndex.get(claim.beneficiary);
    } else if (signingAddressToVoterIndex.get(claim.beneficiary)) {
      voterIndex = signingAddressToVoterIndex.get(claim.beneficiary);
    } else {
      if (claim.beneficiary !== BURN_ADDRESS) {
        throw new Error(`Strange beneficiary: ${claim.beneficiary}`);
      }
    }
    if (claim.claimType === ClaimType.FEE) {
      let currentAmount = voterIndexToFees.get(voterIndex) || 0n;
      voterIndexToFees.set(voterIndex, currentAmount + claim.amount);
    }
    if (claim.claimType === ClaimType.WNAT) {
      let currentAmount = voterIndexToParticipationRewards.get(voterIndex) || 0n;
      voterIndexToParticipationRewards.set(voterIndex, currentAmount + claim.amount);
    }
    if (claim.claimType === ClaimType.MIRROR) {
      let currentAmount = voterIndexToParticipationRewards.get(voterIndex) || 0n;
      voterIndexToParticipationRewards.set(voterIndex, currentAmount + claim.amount);
    }
  }
  logger.log("VOTER FEE PERCENTAGES:");
  for (let i = 0; i < voters.length; i++) {
    const feeVal = voterIndexToFees.get(i) || 0n;
    const partVal = voterIndexToParticipationRewards.get(i) || 0n;
    let percentage = 0;
    if (feeVal + partVal > 0) {
      percentage = Number(feeVal * 10000n / (feeVal + partVal)) / 100;
    }
    logger.log(`Voter: ${i} fee: ${voters[i].delegationFeeBIPS} feeVal: ${feeVal}, part: ${partVal}, pct: ${percentage}`);
  }
}
function voterSummary(voterIndex: number, voter: TestVoter): string {
  return `Voter: ${voterIndex} feePCT: ${voter.delegationFeeBIPS} del: ${voter.delegationAddress.toLowerCase().slice(0, 10)} sign: ${voter.signingAddress.toLowerCase().slice(0, 10)} sub: ${voter.submitAddress.toLowerCase().slice(0, 10)} sigSub: ${voter.submitSignaturesAddress.toLowerCase().slice(0, 10)} weight: ${voter.registrationWeight}`;
}

export function votersSummary(voters: TestVoter[], logger: ILogger = emptyLogger) {
  logger.log("VOTER SUMMARY:");
  for (let i = 0; i < voters.length; i++) {
    const voter = voters[i];
    logger.log(voterSummary(i, voter));
  }
}

export function offersSummary(offers: RewardOffers, logger: ILogger = emptyLogger) {
  logger.log("OFFERS SUMMARY:");
  let totalOffers = 0n;
  for (let offer of offers.rewardOffers) {
    totalOffers += offer.amount;
  }
  let totalInflationOffers = 0n;
  for (let offer of offers.inflationOffers) {
    totalInflationOffers += offer.amount;
  }
  logger.log(`Community offers: ${offers.rewardOffers.length}, total: ${totalOffers}`);
  logger.log(`Inflation offers: ${offers.inflationOffers.length}, total: ${totalInflationOffers}`);
}
