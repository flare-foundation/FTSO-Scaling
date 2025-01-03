import {
  IProtocolMessageMerkleRoot,
  ProtocolMessageMerkleRoot,
} from "../../libs/ftso-core/src/fsp-utils/ProtocolMessageMerkleRoot";
import { rewardEpochCalculationData } from "../stats-utils";

export interface SignerInfo {
  voterIndex: number;
  address: string;
  message: IProtocolMessageMerkleRoot;
  inGracePeriod: boolean;
  relativeTimestamp: number;
  successful: boolean; // if message signed is the finalized one
  weight: number;
}

export interface SignatureDataForVotingRound {
  votingRoundId: number;
  data: SignerInfo[];
  totalWeight: number;
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

    if (roundData === undefined) {
      console.log(`No data for voting round ${votingRoundId}`);
      break;
    }
    const signerInfos: SignerInfo[] = [];

    for (const signatures of roundData.signatures || []) {
      for (const signature of signatures.signatures) {
        const voterIndex = signature.messages.index;
        signerInfos.push({
          voterIndex,
          weight: data.rewardEpochInfo.signingPolicy.weights[voterIndex],
          address: signature.messages.signer,
          message: signature.messages.message,
          inGracePeriod: signature.relativeTimestamp <= signatureGracePeriodEndOffset,
          // TODO: handle the overflow
          relativeTimestamp: signature.relativeTimestamp,
          successful:
            roundData.firstSuccessfulFinalization &&
            ProtocolMessageMerkleRoot.equals(
              signature.messages.message,
              roundData.firstSuccessfulFinalization.messages.protocolMessageMerkleRoot
            ),
        });
      }
    }

    signerInfos.sort((a, b) => a.relativeTimestamp - b.relativeTimestamp);
    const totalWeight = signerInfos.reduce((a, b) => a + b.weight, 0);
    result.push({
      votingRoundId,
      data: signerInfos,
      totalWeight,
    });
  }
  return {
    rewardEpochId,
    signatureData: result,
  };
}

export function printSignatureSummary(data: SignatureData) {
  for (const sigVotingRoundId of data.signatureData) {
    let signerString = `${sigVotingRoundId.votingRoundId}: [${sigVotingRoundId.totalWeight}]`;
    for (const signerInfo of sigVotingRoundId.data) {
      signerString += ` ${signerInfo.voterIndex ?? signerInfo.address.slice(0, 10)}${signerInfo.inGracePeriod ? "G" : ""
        }${signerInfo.successful ? "" : "X"}(${signerInfo.relativeTimestamp})`;
    }
    console.log(signerString);
  }
  console.log("------ Interpretation ------");
  console.log(
    `voting round id: [deposited weight] ...signerIndexOrAddress[G-in grace period][X-not matching finalized merkle root](relative timestamp in sec)`
  );
}
