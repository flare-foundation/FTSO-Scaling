import { ISignaturePayload } from "../../../../ftso-core/src/fsp-utils/SignaturePayload";
import { GenericSubmissionData, SubmissionData } from "../../../../ftso-core/src/IndexerClient";
import { RewardEpoch } from "../../../../ftso-core/src/RewardEpoch";
import { FDC_PROTOCOL_ID } from "../../../../ftso-core/src/constants";
import { AttestationRequest } from "../../../../contracts/src/events/AttestationRequest";
import { Address, MessageHash } from "../../../../ftso-core/src/voting-types";
import {WRONG_SIGNATURE_INDICATOR_MESSAGE_HASH} from "../../constants";
import {
   FDCEligibleSigner,
   FDCOffender,
   FDCOffense,
   FDCRewardData
} from "../../data-calculation-interfaces";

/**
 * Given a list of attestation request events it calculates the list of indices of same requests.
 * The first index in such sub-list is the representative of the same requests.
 */
export function uniqueRequestsIndices(attestationRequests: AttestationRequest[]): number[][] {
   const encountered = new Map<string, number>();
   const result: number[][] = [];
   for (let i = 0; i < attestationRequests.length; i++) {
      const request = attestationRequests[i];
      if (!encountered.get(request.data)) {
         encountered.set(request.data, result.length);
         result.push([i]);
      } else {
         result[encountered.get(request.data)].push(i);
      }
   }
   return result;
}

/**
 * Given a bitvote string (bytes in hex) it returns the indices of accepted attestation requests.
 */
export function bitVoteIndices(bitVote: string, len: number): number[] | undefined {
   if (!bitVote || bitVote.length < 4) {
      return undefined
   }
   const length = parseInt(bitVote.slice(2, 4), 16);
   if (length !== len) {
      throw new Error(`Bitvote length mismatch: ${length} !== ${len}`);
   }

   const result: number[] = [];
   let bitVoteNum = BigInt("0x" + bitVote.slice(4));
   return bitVoteIndicesNum(bitVoteNum, len);
}

/**
 * Given a number representing a bitvote it returns the indices of accepted attestation requests.
 */
export function bitVoteIndicesNum(bitVoteNum: bigint, len: number): number[] {
   const result: number[] = [];
   for (let i = 0; i < len; i++) {
      if (bitVoteNum % 2n === 1n) {
         result.push(i);
      }
      bitVoteNum /= 2n;
   }
   if (bitVoteNum !== 0n) {
      throw new Error(`bitVoteNum not fully consumed: ${bitVoteNum}`);
   }
   return result;
}

/**
 * Returns true if the string encoded bitvote dominates the number encoded consensus bitvote.
 */
function isConsensusVoteDominated(consensusBitVote: bigint, bitVote?: string): boolean {
   if (!bitVote) {
      return false;
   }
   // Remove 0x prefix and first 2 bytes, used for the length
   let h1 = consensusBitVote.toString(16);
   // Ensure even length
   if (h1.length % 2 !== 0) {
      h1 = "0" + h1;
   }
   // This one is always even length
   // first 2-bytes are skipped (length)
   let h2 = bitVote.startsWith("0x") ? bitVote.slice(6) : bitVote.slice(4);
   if (h1.length !== h2.length) {
      const mLen = Math.max(h1.length, h2.length);
      h1 = h1.padStart(mLen, "0");
      h2 = h2.padStart(mLen, "0");
   }
   const buf1 = Buffer.from(h1, "hex");
   const buf2 = Buffer.from(h2, "hex");
   // AND operation should not decrease the number of 1s
   const bufResult = buf1.map((b, i) => b & buf2[i]);
   return buf1.equals(bufResult);
}

/**
 * Given finalized messageHash it calculates consensus bit-vote, filters out eligible signers and determines 
 * offenders.
 * Message hash of the finalized (consensus) message is required or exception is thrown.
 * The @param fdcSignatures is expected to be a map containing at most 2 keys:
 * - messageHash
 * - WRONG_SIGNATURE_INDICATOR_MESSAGE_HASH
 * If there are no signatures for the messageHash, the function returns undefined.
 */
export function extractFDCRewardData(
   messageHash: string,
   bitVoteSubmissions: SubmissionData[],
   fdcSignatures: Map<MessageHash, GenericSubmissionData<ISignaturePayload>[]>,
   rewardEpoch: RewardEpoch,
): FDCRewardData {
   // consensus bitvote -> weight
   const voteCounter = new Map<bigint, number>();
   // List of records about signers which are eligible for the reward.
   // Note that a subset of those is later rewarded
   const eligibleSigners: FDCEligibleSigner[] = [];
   // submitSignatureAddress -> FDCOffender
   const offenseMap = new Map<Address, FDCOffender>();
   if (!messageHash) {
      throw new Error("Consensus message hash is required");
   }
   const signatures = fdcSignatures.get(messageHash);
   if (!signatures) {
      return {
         eligibleSigners: [],
         consensusBitVote: undefined,
         fdcOffenders: []
      };
   }
   for (const signature of signatures) {
      const consensusBitVoteCandidate = signature.messages.unsignedMessage?.toLowerCase();
      // first 2 bytes are length
      if (!consensusBitVoteCandidate || consensusBitVoteCandidate.length < 6) {
         continue;
      }
      const bitVoteNum = BigInt("0x" + consensusBitVoteCandidate.slice(6));
      // Note that 0n is also a legit consensus bitvote meaning no confirmations (but might not be rewarded)
      voteCounter.set(bitVoteNum, (voteCounter.get(bitVoteNum) || 0) + signature.messages.weight)
   }
   let consensusBitVote: bigint | undefined;
   if (voteCounter.size > 0) {
      const maxCount = Math.max(...voteCounter.values());
      const maxBitVotes = [...voteCounter.entries()].filter(([_, count]) => count === maxCount).map(([bitVote, _]) => bitVote);
      maxBitVotes.sort();
      // if it happens there are multiple maxHashes we take the first in order
      consensusBitVote = maxBitVotes[0];

      // TODO:
      // should we require 50%+ weight on maxHash?
      // const consensusBitVoteWeight = voteCounter.get(consensusBitVote);
      // if(consensusBitVoteWeight < rewardEpoch.signingPolicy.threshold) {
      //   return undefined;
      // }
   }

   const submitSignatureAddressToBitVote = new Map<Address, string>();
   for (const submission of bitVoteSubmissions) {
      const submitSignatureAddress = rewardEpoch.getSubmitSignatureAddressFromSubmitAddress(submission.submitAddress.toLowerCase()).toLowerCase();
      const message = submission.messages.find(m => m.protocolId === FDC_PROTOCOL_ID);
      if (message && message.payload) {
         submitSignatureAddressToBitVote.set(submitSignatureAddress, message.payload.toLowerCase());
      }
   }

   const submitSignatureSenders = new Set<Address>();

   for (const signature of signatures) {
      // too late
      if (signature.relativeTimestamp >= 90) {
         continue;
      }
      const submitSignatureAddress = signature.submitAddress.toLowerCase()
      submitSignatureSenders.add(submitSignatureAddress);
      const bitVote = submitSignatureAddressToBitVote.get(submitSignatureAddress);
      const eligibleSigner: FDCEligibleSigner = {
         submitSignatureAddress: signature.submitAddress.toLowerCase(),
         timestamp: signature.timestamp,
         votingEpochIdFromTimestamp: signature.votingEpochIdFromTimestamp,
         relativeTimestamp: signature.relativeTimestamp,
         bitVote,
         dominatesConsensusBitVote: consensusBitVote === undefined ? undefined : isConsensusVoteDominated(consensusBitVote, bitVote),
         weight: signature.messages.weight,
      }
      eligibleSigners.push(eligibleSigner);
   }

   for (const submission of bitVoteSubmissions) {
      const submitSignatureAddress = rewardEpoch.getSubmitSignatureAddressFromSubmitAddress(submission.submitAddress).toLowerCase();
      const submissionAddress = rewardEpoch.getSubmitAddressFromSubmitSignatureAddress(submitSignatureAddress).toLowerCase();
      if (!submitSignatureSenders.has(submitSignatureAddress)) {
         const offender: FDCOffender = {
            submitSignatureAddress,
            submissionAddress,
            weight: rewardEpoch.getSigningWeightForSubmitSignatureAddress(submitSignatureAddress),
            offenses: [FDCOffense.NO_REVEAL_ON_BITVOTE]
         }
         offenseMap.set(submitSignatureAddress, offender);
      }
   }

   const wrongSignatures = fdcSignatures.get(WRONG_SIGNATURE_INDICATOR_MESSAGE_HASH);
   if (wrongSignatures) {
      for (const signature of wrongSignatures) {
         const submitSignatureAddress = signature.submitAddress.toLowerCase();
         const submissionAddress = rewardEpoch.getSubmitAddressFromSubmitSignatureAddress(submitSignatureAddress).toLowerCase();
         if (!rewardEpoch.isEligibleSubmitSignatureAddress(submitSignatureAddress)) {
            continue;
         }
         const offender = offenseMap.get(submitSignatureAddress) || {
            submitSignatureAddress,
            submissionAddress,
            weight: rewardEpoch.getSigningWeightForSubmitSignatureAddress(submitSignatureAddress),
            offenses: []
         }
         offender.offenses.push(FDCOffense.WRONG_SIGNATURE);
         offenseMap.set(submitSignatureAddress, offender);
      }
   }
   for (const signature of signatures) {
      const submitSignatureAddress = signature.submitAddress.toLowerCase();
      const submissionAddress = rewardEpoch.getSubmitAddressFromSubmitSignatureAddress(submitSignatureAddress).toLowerCase();
      const consensusBitVoteCandidate = signature.messages.unsignedMessage?.toLowerCase();
      if (!consensusBitVoteCandidate) {
         continue;
      }
      // Offense is either wrong bitvote message or not matching the consensus bitvote
      // 0x + 2 bytes length
      let isOffense = consensusBitVoteCandidate.length < 6;
      if (!isOffense) {
         isOffense = BigInt("0x" + consensusBitVoteCandidate.slice(6)) !== consensusBitVote;
      }
      if (isOffense) {
         const offender = offenseMap.get(submitSignatureAddress) || {
            submitSignatureAddress,
            submissionAddress,
            weight: rewardEpoch.getSigningWeightForSubmitSignatureAddress(submitSignatureAddress),
            offenses: []
         }
         offender.offenses.push(FDCOffense.BAD_CONSENSUS_BITVOTE_CANDIDATE);
         offenseMap.set(submitSignatureAddress, offender);
      }
   }

   const fdcOffenders = [...offenseMap.values()];
   // Fix the orders for determinism
   fdcOffenders.sort((a, b) => a.submitSignatureAddress.localeCompare(b.submitSignatureAddress));
   for(const offender of fdcOffenders) {
      offender.offenses.sort();
   }
   const result: FDCRewardData = {
      eligibleSigners,
      consensusBitVote,
      fdcOffenders
   };

   return result;
}
