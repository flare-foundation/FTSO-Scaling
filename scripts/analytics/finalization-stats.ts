import { rewardEpochCalculationData } from "../stats-utils";

export interface FinalizerInfo {
  voterIndex: number;
  address: string;
  successful: boolean;
  inGracePeriod: boolean;
  relativeTimestamp: number;
}

export interface SelectedVoter {
  voterIndex: number;
  address: string;
}

export interface FinalizationDataForVotingRound {
  votingRoundId: number;
  selectedVoters: SelectedVoter[];
  data: FinalizerInfo[];
}

export interface FinalizationData {
  rewardEpochId: number;
  finalizationData: FinalizationDataForVotingRound[];
}

export async function finalizationSummary(
  rewardEpochId: number,
  finalizationGracePeriodEndOffset: number,
  endVotingRoundId?: number
): Promise<FinalizationData> {
  const data = await rewardEpochCalculationData(rewardEpochId, endVotingRoundId);
  const signingAddressToVoterId = new Map<string, number>();
  for (let i = 0; i < data.rewardEpochInfo.voterRegistrationInfo.length; i++) {
    signingAddressToVoterId.set(data.rewardEpochInfo.voterRegistrationInfo[i].voterRegistered.signingPolicyAddress, i);
  }
  const result: FinalizationDataForVotingRound[] = [];
  for (let votingRoundId = data.startVotingRoundId; votingRoundId <= data.endVotingRoundId; votingRoundId++) {
    const roundData = data.votingRoundIdToRewardCalculationData.get(votingRoundId);

    const finalizerInfos: FinalizerInfo[] = roundData.finalizations.map(finalization => {
      const voterIndex = signingAddressToVoterId.get(finalization.submitAddress);
      return {
        voterIndex,
        address: finalization.submitAddress,
        successful: finalization.successfulOnChain,
        inGracePeriod: finalization.relativeTimestamp <= finalizationGracePeriodEndOffset,
        relativeTimestamp: finalization.relativeTimestamp,
      };
    });
    finalizerInfos.sort((a, b) => a.relativeTimestamp - b.relativeTimestamp);
    const selectedVoters = roundData.eligibleFinalizers.map(address => {
      const voterIndex = signingAddressToVoterId.get(address);
      return {
        voterIndex,
        address,
      } as SelectedVoter;
    });
    result.push({
      votingRoundId,
      selectedVoters,
      data: finalizerInfos,
    });
  }
  return {
    rewardEpochId,
    finalizationData: result,
  };
}

export function printFinalizationSummary(finalizations: FinalizationData) {
  for (const finVotingRoundId of finalizations.finalizationData) {
    let finalizationString = `${finVotingRoundId.votingRoundId}: [${finVotingRoundId.selectedVoters
      .map(voter => voter.voterIndex)
      .join(", ")}]`;
    for (const finalizerInfo of finVotingRoundId.data) {
      finalizationString += ` ${finalizerInfo.voterIndex ?? finalizerInfo.address.slice(0, 10)}${
        finalizerInfo.successful ? "F" : ""
      }${finalizerInfo.inGracePeriod ? "G" : ""}(${finalizerInfo.relativeTimestamp})`;
    }
    console.log(finalizationString);
  }
  console.log("------ Interpretation ------");
  console.log(
    `voting round id: [selected finalizers] ...finalizerIndexOrAddress[F-first finalizer][G-in grace period](relative timestamp sec)`
  );
}
