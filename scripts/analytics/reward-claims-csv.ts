import { appendFileSync, writeFileSync } from "fs";
import { ClaimType, IPartialRewardClaim } from "../../libs/fsp-rewards/src/utils/RewardClaim";
import { deserializePartialClaimsForVotingRoundId } from "../../libs/fsp-rewards/src/utils/stat-info/partial-claims";
import { deserializeRewardEpochInfo } from "../../libs/fsp-rewards/src/utils/stat-info/reward-epoch-info";
import { flrFormat } from "../../test/utils/reward-claim-summaries";
import {BURN_ADDRESS} from "../../libs/fsp-rewards/src/constants";

export interface CSVRewardClaim extends IPartialRewardClaim {
  rewardEpochId: number;
  identityAddress: string;
  delegationAddress: string;
  voterIndex: number;
  signingWeightPct: number;
  delegationWeightPct: number;
  cappedDelegationWeightPct: number;
  burnedForVoterId?: number;
}

function writeAllClaimsForRewardEpochRange(startRewardEpochId: number, endRewardEpoch: number, filename: string) {
  let csv =
    "votingRoundId,rewardEpochId,beneficiary,voterIndex,signingWeightPct,delegationWeightPct,cappedDelegationWeight,amount,claimType,feedId,offerIndex,protocolTag,rewardTypeTag,rewardDetailTag,burnedForVoterId,identityAddress,delegationAddress,amountNAT\n";
  writeFileSync(filename, csv);

  // const feedData: CSVRewardClaim[] = [];
  for (let rewardEpochId = startRewardEpochId; rewardEpochId <= endRewardEpoch; rewardEpochId++) {
    const rewardEpochInfo = deserializeRewardEpochInfo(rewardEpochId);
    const signingAddressToVoterId = new Map<string, number>();
    const identityAddressToVoterId = new Map<string, number>();
    const voterIdToIdentityAddress = new Map<number, string>();
    const voterIdToDelegationAddress = new Map<number, string>();
    const delegationAddressToVoterId = new Map<string, number>();
    const voterIdToSigningWeightPct = new Map<number, number>();
    const voterIdToDelegationWeightPct = new Map<number, number>();
    const voterIdToCappedDelegationWeightPct = new Map<number, number>();

    // total signing weight
    let totalSigningWeight = 0;
    for (let i = 0; i < rewardEpochInfo.signingPolicy.weights.length; i++) {
      totalSigningWeight += rewardEpochInfo.signingPolicy.weights[i];
    }
    let totalDelegationWeight = 0n;
    let totalCappedDelegationWeight = 0n;
    for (let i = 0; i < rewardEpochInfo.voterRegistrationInfo.length; i++) {
      totalDelegationWeight += rewardEpochInfo.voterRegistrationInfo[i].voterRegistrationInfo.wNatWeight;
      totalCappedDelegationWeight += rewardEpochInfo.voterRegistrationInfo[i].voterRegistrationInfo.wNatCappedWeight;
    }
    for (let i = 0; i < rewardEpochInfo.voterRegistrationInfo.length; i++) {
      signingAddressToVoterId.set(
        rewardEpochInfo.voterRegistrationInfo[i].voterRegistered.signingPolicyAddress.toLowerCase(),
        i
      );
      identityAddressToVoterId.set(rewardEpochInfo.voterRegistrationInfo[i].voterRegistered.voter.toLowerCase(), i);
      voterIdToIdentityAddress.set(i, rewardEpochInfo.voterRegistrationInfo[i].voterRegistered.voter.toLowerCase());
      delegationAddressToVoterId.set(
        rewardEpochInfo.voterRegistrationInfo[i].voterRegistrationInfo.delegationAddress.toLowerCase(),
        i
      );
      voterIdToDelegationAddress.set(
        i,
        rewardEpochInfo.voterRegistrationInfo[i].voterRegistrationInfo.delegationAddress.toLowerCase()
      );
      voterIdToSigningWeightPct.set(i, (rewardEpochInfo.signingPolicy.weights[i] / totalSigningWeight) * 100);
      voterIdToDelegationWeightPct.set(
        i,
        (Number(rewardEpochInfo.voterRegistrationInfo[i].voterRegistrationInfo.wNatWeight) /
          Number(totalDelegationWeight)) *
        100
      );
      voterIdToCappedDelegationWeightPct.set(
        i,
        (Number(rewardEpochInfo.voterRegistrationInfo[i].voterRegistrationInfo.wNatCappedWeight) /
          Number(totalCappedDelegationWeight)) *
        100
      );
    }
    const endVotingRoundId = rewardEpochInfo.endVotingRoundId ?? Number.POSITIVE_INFINITY;

    for (
      let votingRoundId = rewardEpochInfo.signingPolicy.startVotingRoundId;
      votingRoundId <= endVotingRoundId;
      votingRoundId++
    ) {
      try {
        const partialClaims = deserializePartialClaimsForVotingRoundId(rewardEpochId, votingRoundId);
        for (const claim of partialClaims) {
          let voterIndex = -1;
          let identityAddress = "";
          let delegationAddress = "";
          let signingWeightPct = 0;
          let delegationWeightPct = 0;
          let cappedDelegationWeightPct = 0;
          let burnedForVoterId: number | undefined = undefined;
          if (claim.claimType === ClaimType.FEE) {
            voterIndex = identityAddressToVoterId.get(claim.beneficiary.toLowerCase());
            identityAddress = claim.beneficiary.toLowerCase();
            delegationAddress = voterIdToDelegationAddress.get(voterIndex) ?? "";
          } else if (claim.claimType === ClaimType.WNAT) {
            voterIndex = delegationAddressToVoterId.get(claim.beneficiary.toLowerCase());
            identityAddress = voterIdToIdentityAddress.get(voterIndex) ?? "";
            delegationAddress = voterIdToDelegationAddress.get(voterIndex) ?? "";
          } else if (claim.claimType === ClaimType.DIRECT) {
            const tryIndex = signingAddressToVoterId.get(claim.beneficiary.toLowerCase());
            if (tryIndex !== undefined) {
              voterIndex = tryIndex;
              identityAddress = voterIdToIdentityAddress.get(voterIndex) ?? "";
              delegationAddress = voterIdToDelegationAddress.get(voterIndex) ?? "";
            }
          }
          if (voterIndex >= 0) {
            signingWeightPct = voterIdToSigningWeightPct.get(voterIndex) ?? 0;
            delegationWeightPct = voterIdToDelegationWeightPct.get(voterIndex) ?? 0;
            cappedDelegationWeightPct = voterIdToCappedDelegationWeightPct.get(voterIndex) ?? 0;
          }
          burnedForVoterId = signingAddressToVoterId.get(claim.burnedForVoter?.toLowerCase());
          const fixedClaim: CSVRewardClaim = {
            ...claim,
            rewardEpochId,
            identityAddress,
            delegationAddress,
            voterIndex,
            signingWeightPct,
            delegationWeightPct,
            cappedDelegationWeightPct,
            burnedForVoterId,
          };
          const line = `${fixedClaim.votingRoundId},${fixedClaim.rewardEpochId},${fixedClaim.beneficiary},${fixedClaim.voterIndex},${fixedClaim.signingWeightPct
            },${fixedClaim.delegationWeightPct},${fixedClaim.cappedDelegationWeightPct},${fixedClaim.amount},${ClaimType[fixedClaim.claimType]
            },${decodeFeed(fixedClaim.feedId)},${fixedClaim.offerIndex ?? ""},${fixedClaim.protocolTag ?? ""},${fixedClaim.rewardTypeTag ?? ""},${fixedClaim.rewardDetailTag
            },${fixedClaim.burnedForVoterId ?? ""},${fixedClaim.identityAddress},${fixedClaim.delegationAddress},${Number(fixedClaim.amount) / Math.pow(10, 18)}\n`;
          appendFileSync(filename, line);

          // feedData.push(fixedClaim);
        }
      } catch (e) {
        console.log(e);
        console.log(`Cannot read partial claims for voting round ${votingRoundId} in reward epoch ${rewardEpochId}`);
        console.log(`Finished with last voting round ${votingRoundId - 1} in reward epoch ${rewardEpochId}`);
        break;
      }
      if (votingRoundId % 100 === 0) {
        console.log(`Done voting round ${votingRoundId}`);
      }
    }
  }
  // return feedData;
}

function decodeFeed(feedIdHex: string): string {
  if(!feedIdHex) {
    return "------";
  }
  const name = Buffer.from(feedIdHex.slice(4), "hex").toString("utf8").replaceAll("\0", "");
  return name;
}

export function claimsToCSV(startRewardEpochId: number, endRewardEpoch: number, filename: string) {
  let totalAmount = 0n;
  let negativeAmount = 0n;
  let burnedAmount = 0n;
  writeAllClaimsForRewardEpochRange(startRewardEpochId, endRewardEpoch, filename);

  // for (const claim of feedData) {
  //   if (claim.amount > 0n) {
  //     totalAmount += claim.amount;
  //   }
  //   if (claim.amount < 0n) {
  //     negativeAmount += -claim.amount;
  //   }
  //   if (claim.beneficiary.toLowerCase() === BURN_ADDRESS.toLowerCase()) {
  //     burnedAmount += claim.amount;
  //   }
  //   const line = `${claim.votingRoundId},${claim.rewardEpochId},${claim.beneficiary},${claim.voterIndex},${claim.signingWeightPct
  //     },${claim.delegationWeightPct},${claim.cappedDelegationWeightPct},${claim.amount},${ClaimType[claim.claimType]
  //     },${decodeFeed(claim.feedId)},${claim.offerIndex ?? ""},${claim.protocolTag ?? ""},${claim.rewardTypeTag ?? ""},${claim.rewardDetailTag
  //     },${claim.burnedForVoterId ?? ""},${claim.identityAddress},${claim.delegationAddress},${Number(claim.amount) / Math.pow(10, 18)}\n`;
  //   appendFileSync(filename, line);
  // }
  // console.log(`Total: ${flrFormat(totalAmount)}(${totalAmount}), negative: ${flrFormat(negativeAmount)}(${negativeAmount}), burned: ${flrFormat(burnedAmount)}(${burnedAmount}, ${Math.round(Number(burnedAmount) / Number(totalAmount) * 10000) / 100}%)`)
}
