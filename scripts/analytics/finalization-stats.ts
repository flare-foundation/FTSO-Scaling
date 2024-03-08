import { rewardEpochCalculationData } from "../stats-utils";

async function finalizationSummary(rewardEpochId: number, finalizationGracePeriodEndOffset: number, endVotingRoundId?: number) {
   const data = await rewardEpochCalculationData(rewardEpochId, endVotingRoundId);
   const signingAddressToVoterId = new Map<string, number>();
   for (let i = 0; i < data.rewardEpochInfo.voterRegistrationInfo.length; i++) {
      signingAddressToVoterId.set(data.rewardEpochInfo.voterRegistrationInfo[i].voterRegistered.signingPolicyAddress, i);
   }
   for (let votingRoundId = data.startVotingRoundId; votingRoundId <= data.endVotingRoundId; votingRoundId++) {
      const roundData = data.votingRoundIdToRewardCalculationData.get(votingRoundId);
      interface FinalizerInfo {
         voterIndex: number;
         address: string;
         successful: boolean;
         inGracePeriod: boolean;
         relativeTimestamp: number;
      }

      const finalizerInfos = roundData.finalizations.map((finalization) => {
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
      let finalizationString = `${votingRoundId}:`;
      for (let finalizerInfo of finalizerInfos) {
         finalizationString += ` ${finalizerInfo.voterIndex ?? finalizerInfo.address.slice(0, 10)}${finalizerInfo.successful ? "F" : ""}${finalizerInfo.inGracePeriod ? "G" : ""}(${finalizerInfo.relativeTimestamp})`;
      }
      console.log(finalizationString);
   }
}

async function main() {
   if (!process.argv[2]) {
      throw new Error("no rewardEpochId");
   }
   const rewardEpochId = parseInt(process.argv[2]);
   if (!process.argv[3]) {
      throw new Error("no finalizationGracePeriodEndOffset");
   }
   const finalizationGracePeriodEndOffset = parseInt(process.argv[3]);
   const endVotingRoundId = process.argv[5] ? parseInt(process.argv[4]) : undefined;
   await finalizationSummary(rewardEpochId, finalizationGracePeriodEndOffset, endVotingRoundId);
}

main().then(() => {
   console.dir("Done")
   process.exit(0);
}).catch((e) => {
   console.error(e);
   process.exit(1);
});


