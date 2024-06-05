import { writeFileSync } from "fs";
import { ClaimType, IPartialRewardClaim } from "../../libs/ftso-core/src/utils/RewardClaim";
import { deserializePartialClaimsForVotingRoundId } from "../../libs/ftso-core/src/utils/stat-info/partial-claims";
import { deserializeRewardEpochInfo } from "../../libs/ftso-core/src/utils/stat-info/reward-epoch-info";

export interface CSVRewardClaim extends IPartialRewardClaim {
  rewardEpochId: number;
  identityAddress: string;
  voterIndex: number;
  signingWeightPct: number;
  delegationWeightPct: number;
  cappedDelegationWeightPct: number;
}

function getAllClaimsForRewardEpochRange(startRewardEpochId: number, endRewardEpoch: number): CSVRewardClaim[] {
  const feedData: CSVRewardClaim[] = [];
  for (let rewardEpochId = startRewardEpochId; rewardEpochId <= endRewardEpoch; rewardEpochId++) {
    const rewardEpochInfo = deserializeRewardEpochInfo(rewardEpochId);
    const signingAddressToVoterId = new Map<string, number>();
    const identityAddressToVoterId = new Map<string, number>();
    const voterIdToIdentityAddress = new Map<number, string>();
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

    for (
      let votingRoundId = rewardEpochInfo.signingPolicy.startVotingRoundId;
      votingRoundId <= rewardEpochInfo.endVotingRoundId!;
      votingRoundId++
    ) {
      const partialClaims = deserializePartialClaimsForVotingRoundId(rewardEpochId, votingRoundId);
      for (const claim of partialClaims) {
        let voterIndex = -1;
        let identityAddress = "";
        let signingWeightPct = 0;
        let delegationWeightPct = 0;
        let cappedDelegationWeightPct = 0;
        if (claim.claimType === ClaimType.FEE) {
          voterIndex = identityAddressToVoterId.get(claim.beneficiary.toLowerCase());
          identityAddress = claim.beneficiary.toLowerCase();
        } else if (claim.claimType === ClaimType.WNAT) {
          voterIndex = delegationAddressToVoterId.get(claim.beneficiary.toLowerCase());
          identityAddress = voterIdToIdentityAddress.get(voterIndex) ?? "";
        } else if (claim.claimType === ClaimType.DIRECT) {
          const tryIndex = signingAddressToVoterId.get(claim.beneficiary.toLowerCase());
          if (tryIndex !== undefined) {
            voterIndex = tryIndex;
            identityAddress = voterIdToIdentityAddress.get(voterIndex) ?? "";
          }
        }
        if (voterIndex >= 0) {
          signingWeightPct = voterIdToSigningWeightPct.get(voterIndex) ?? 0;
          delegationWeightPct = voterIdToDelegationWeightPct.get(voterIndex) ?? 0;
          cappedDelegationWeightPct = voterIdToCappedDelegationWeightPct.get(voterIndex) ?? 0;
        }

        const fixedClaim: CSVRewardClaim = {
          ...claim,
          rewardEpochId,
          identityAddress,
          voterIndex,
          signingWeightPct,
          delegationWeightPct,
          cappedDelegationWeightPct,
        };
        feedData.push(fixedClaim);
      }
    }
  }
  return feedData;
}

function decodeFeed(feedIdHex: string): string {
  const name = Buffer.from(feedIdHex.slice(4), "hex").toString("utf8").replaceAll("\0", "");
  return name;
}

export function claimsToCSV(startRewardEpochId: number, endRewardEpoch: number, filename: string) {
  const feedData = getAllClaimsForRewardEpochRange(startRewardEpochId, endRewardEpoch);
  let csv =
    "votingRoundId,rewardEpochId,beneficiary,voterIndex,signingWeightPct,delegationWeightPct,cappedDelegationWeight,amount,claimType,feedId,offerIndex,protocolTag,rewardTypeTag,rewardDetailTag,burnedForVoter\n";
  csv += feedData
    .map(claim => {
      return `${claim.votingRoundId},${claim.rewardEpochId},${claim.beneficiary},${claim.voterIndex},${
        claim.signingWeightPct
      },${claim.delegationWeightPct},${claim.cappedDelegationWeightPct},${Number(claim.amount).toString()},${
        ClaimType[claim.claimType]
      },${decodeFeed(claim.feedId)},${claim.offerIndex ?? ""},${claim.protocolTag ?? ""},${claim.rewardTypeTag ?? ""},${
        claim.rewardDetailTag
      },${claim.burnedForVoter ?? ""}`;
    })
    .join("\n");
  writeFileSync(filename, csv);
}
