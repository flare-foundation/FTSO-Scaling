import {
  IProtocolMessageMerkleRoot,
  ProtocolMessageMerkleRoot,
} from "../../libs/fsp-utils/src/ProtocolMessageMerkleRoot";
import { rewardEpochCalculationData } from "../stats-utils";

export interface SignerInfo {
  voterIndex: number;
  address: string;
  message: IProtocolMessageMerkleRoot;
  inGracePeriod: boolean;
  relativeTimestamp: number;
  successful: boolean; // if message signed is the finalized one
}

export interface SignatureDataForVotingRound {
  votingRoundId: number;
  data: SignerInfo[];
}

export interface SignatureData {
  rewardEpochId: number;
  signatureData: SignatureDataForVotingRound[];
}

export async function signatureSummary(
  rewardEpochId: number,
  signatureGracePeriodEndOffset: number,
  endVotingRoundId?: number
): Promise<SignatureData> {
  const data = await rewardEpochCalculationData(rewardEpochId, endVotingRoundId);
  const signingAddressToVoterId = new Map<string, number>();

  for (let i = 0; i < data.rewardEpochInfo.voterRegistrationInfo.length; i++) {
    signingAddressToVoterId.set(data.rewardEpochInfo.voterRegistrationInfo[i].voterRegistered.signingPolicyAddress, i);
  }
  const result: SignatureDataForVotingRound[] = [];
  for (let votingRoundId = data.startVotingRoundId; votingRoundId <= data.endVotingRoundId; votingRoundId++) {
    const roundData = data.votingRoundIdToRewardCalculationData.get(votingRoundId);

    const signerInfos: SignerInfo[] = [];

    for (const signatures of roundData.signatures) {
      for (const signature of signatures.signatures) {
        const voterIndex = signature.messages.index;
        signerInfos.push({
          voterIndex,
          address: signature.messages.signer,
          message: signature.messages.message,
          inGracePeriod: signature.relativeTimestamp <= signatureGracePeriodEndOffset,
          // TODO: handle the overflow
          relativeTimestamp: signature.relativeTimestamp,
          successful: ProtocolMessageMerkleRoot.equals(
            signature.messages.message,
            roundData.firstSuccessfulFinalization.messages.protocolMessageMerkleRoot
          ),
        });
      }
    }

    signerInfos.sort((a, b) => a.relativeTimestamp - b.relativeTimestamp);
    result.push({
      votingRoundId,
      data: signerInfos,
    });
  }
  return {
    rewardEpochId,
    signatureData: result,
  };
}

export function printSignatureSummary(data: SignatureData) {
  for (const sigVotingRoundId of data.signatureData) {
    let signerString = `${sigVotingRoundId.votingRoundId}:`;
    for (const signerInfo of sigVotingRoundId.data) {
      signerString += ` ${signerInfo.voterIndex ?? signerInfo.address.slice(0, 10)}${
        signerInfo.inGracePeriod ? "G" : ""
      }${signerInfo.successful ? "" : "X"}(${signerInfo.relativeTimestamp})`;
    }
    console.log(signerString);
  }
}
