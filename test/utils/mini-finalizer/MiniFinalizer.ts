import { EntityManager } from "typeorm";
import { IECDSASignatureWithIndex } from "../../../libs/fsp-utils/src/ECDSASignatureWithIndex";
import { IRelayMessage, RelayMessage } from "../../../libs/fsp-utils/src/RelayMessage";
import { ISignaturePayload, SignaturePayload } from "../../../libs/fsp-utils/src/SignaturePayload";
import { ISigningPolicy } from "../../../libs/fsp-utils/src/SigningPolicy";
import { DataManager } from "../../../libs/ftso-core/src/DataManager";
import { IndexerClient } from "../../../libs/ftso-core/src/IndexerClient";
import { RewardEpoch } from "../../../libs/ftso-core/src/RewardEpoch";
import { RewardEpochManager } from "../../../libs/ftso-core/src/RewardEpochManager";
import { CONTRACTS, ContractMethodNames, EPOCH_SETTINGS, FTSO2_PROTOCOL_ID } from "../../../libs/ftso-core/src/configs/networks";
import { TLPTransaction } from "../../../libs/ftso-core/src/orm/entities";
import { RandomVoterSelector } from "../../../libs/ftso-core/src/reward-calculation/RandomVoterSelector";
import { EncodingUtils } from "../../../libs/ftso-core/src/utils/EncodingUtils";
import { ILogger } from "../../../libs/ftso-core/src/utils/ILogger";
import { TestVoter, generateTx } from "../generators";
import { Queue } from "./Queue";

const encodingUtils = EncodingUtils.instance;

export interface QueueEntry {
  votingRoundId: number;
  protocolId: number;
  messageHash: string;
}
export class MiniFinalizer {
  private readonly indexerClient: IndexerClient;
  private readonly rewardEpochManger: RewardEpochManager;
  private readonly dataManager: DataManager;

  constructor(
    public voter: TestVoter,
    public voterIndex: number,
    public voterSelector: RandomVoterSelector,
    public entityManager: EntityManager,
    public logger: ILogger
  ) {
    this.indexerClient = new IndexerClient(entityManager, 0);
    this.rewardEpochManger = new RewardEpochManager(this.indexerClient);
    this.dataManager = new DataManager(this.indexerClient, this.rewardEpochManger, this.logger);
  }

  // votingRoundId => protocolId => messageHash => SignaturePayload[]
  results = new Map<number, Map<number, Map<string, ISignaturePayload[]>>>();
  weights = new Map<number, Map<number, Map<string, number>>>();
  // How many signatures in the list are needed to finalize the message
  // if 0 or undefined, then the message does not have enough signatures
  thresholdReached = new Map<number, Map<number, Map<string, number>>>();

  // rewardEpochId => (voterAddress => index)
  voterToIndexMaps = new Map<number, Map<string, number>>();
  voterToWeightMaps = new Map<number, Map<string, number>>();
  // rewardEpochId => ISigningPolicy
  signingPolicies = new Map<number, ISigningPolicy>();
  queue = new Queue<QueueEntry>();

  public async processFinalization(
    votingRoundId: number,
    block: number,
    timestamp: number
  ): Promise<TLPTransaction | undefined> {
    this.queue.destroy()
    const rewardEpoch = await this.rewardEpochManger.getRewardEpoch(votingRoundId);
    const matchingSigningPolicy = rewardEpoch.signingPolicy;
    // process finalizations
    await this.getFinalizationAndProcessFinalizationSubmissions(votingRoundId, rewardEpoch, timestamp);
    // process queue
    while (this.queue.size > 0) {
      const entry = this.queue.shift();
      if (entry.votingRoundId !== votingRoundId) {
        continue;
      }
      const signaturePayloads = this.results.get(entry.votingRoundId)?.get(entry.protocolId)?.get(entry.messageHash);

      const signatures: IECDSASignatureWithIndex[] = signaturePayloads.map((signaturePayload) => {
        return {
          r: signaturePayload.signature.r,
          s: signaturePayload.signature.s,
          v: signaturePayload.signature.v,
          index: signaturePayload.index
        }
      });
      const messageData = signaturePayloads[0].message;
      const relayMessage: IRelayMessage = {
        signingPolicy: matchingSigningPolicy,
        signatures,
        protocolMessageMerkleRoot: messageData,
      }
      const randomSeed = RandomVoterSelector.initialHashSeed(messageData.protocolId, messageData.votingRoundId);
      if (this.voterSelector.inSelectionSet(messageData.protocolId, messageData.votingRoundId, this.voter.submitAddress)) {
        return;
      }

      try {
        // reverts if not enough signature weight
        const fullData = RelayMessage.encode(relayMessage, true);
        const sigRelay = encodingUtils.getFunctionSignature(CONTRACTS.Submission.name, ContractMethodNames.relay);
        return generateTx(
          this.voter.signingAddress,
          CONTRACTS.Relay.address,
          sigRelay,
          block,
          timestamp,
          sigRelay + fullData.slice(2)
        );
      } catch (e) {
        // too little signatures, finalization cannot be done, skip
      }
    }
    return undefined;
  }

  private async getFinalizationAndProcessFinalizationSubmissions(
    votingRoundId: number,
    rewardEpoch: RewardEpoch,
    upToTime: number,
    protocolId = FTSO2_PROTOCOL_ID
  ) {
    const submitSignaturesSubmissionResponse = await this.indexerClient.getSubmissionDataInRange(
      ContractMethodNames.submitSignatures,
      EPOCH_SETTINGS.revealDeadlineSec(votingRoundId + 1) + 1,
      upToTime
    );

    if (!submitSignaturesSubmissionResponse.data) {
      console.log("NO DATA");
      return;
    }
    const signatures = submitSignaturesSubmissionResponse.data;
    DataManager.sortSubmissionDataArray(signatures);
    const finalizationMap = DataManager.extractSignatures(votingRoundId, rewardEpoch, signatures, protocolId);
    if (!finalizationMap) {
      return;
    }
    for (const submissionList of finalizationMap.values()) {
      const signaturePayloads = submissionList.map((submission) => submission.messages);
      this.processSignaturePayloads(signaturePayloads, rewardEpoch.signingPolicy);
    }
  }

  private processSignaturePayloads(signaturePayloads: ISignaturePayload[], matchingSigningPolicy: ISigningPolicy) {
    for (const payload of signaturePayloads) {
      const votingRoundId = payload.message.votingRoundId;
      const protocolId = payload.message.protocolId;
      const voterToIndexMap = this.voterToIndexMaps.get(matchingSigningPolicy.rewardEpochId!);
      const augPayload = SignaturePayload.augment(payload, voterToIndexMap!);
      if (augPayload.signer === undefined) {
        this.logger.log(`Signer not in the signing policy for rewardEpochId: ${matchingSigningPolicy.rewardEpochId!}.`);
        return;
      }
      const messageHash = augPayload.messageHash;
      if (!messageHash) {
        throw new Error(`No message hash for payload: ${JSON.stringify(payload)}`);
      }
      if (!this.results.has(votingRoundId)) {
        this.results.set(votingRoundId, new Map<number, Map<string, ISignaturePayload[]>>());
        this.weights.set(votingRoundId, new Map<number, Map<string, number>>());
      }
      if (!this.results.get(votingRoundId)!.has(protocolId)) {
        this.results.get(votingRoundId)!.set(protocolId, new Map<string, ISignaturePayload[]>());
        this.weights.get(votingRoundId)!.set(protocolId, new Map<string, number>());
      }
      if (!this.results.get(votingRoundId)!.get(protocolId)!.has(messageHash)) {
        this.results.get(votingRoundId)!.get(protocolId)!.set(messageHash, []);
        this.weights.get(votingRoundId)!.get(protocolId)!.set(messageHash, 0);
      }
      let sortedList = this.results.get(votingRoundId)!.get(protocolId)!.get(messageHash)!;
      const inserted = SignaturePayload.insertInSigningPolicySortedList(sortedList, augPayload);

      if (inserted) {
        // check if threshold reached
        const voterToWeightMap = this.voterToWeightMaps.get(matchingSigningPolicy.rewardEpochId!);
        let totalWeight = 0;
        for (const payload of sortedList) {
          totalWeight += voterToWeightMap!.get(payload.signer!)!;
        }
        // this.logger.info(`Total weight: ${totalWeight} (${votingRoundId}, ${protocolId}, ${messageHash}))`);
        this.weights.get(votingRoundId)!.get(protocolId)!.set(messageHash, totalWeight);
        if (totalWeight > matchingSigningPolicy.threshold) {
          if (!this.thresholdReached.has(votingRoundId)) {
            this.thresholdReached.set(votingRoundId, new Map<number, Map<string, number>>());
          }
          if (!this.thresholdReached.get(votingRoundId)!.has(protocolId)) {
            this.thresholdReached.get(votingRoundId)!.set(protocolId, new Map<string, number>());
          }
          if (this.thresholdReached!.get(votingRoundId)!.get(protocolId)!.has(messageHash)) {
            // no need for entering the queue again
            return;
          }
          this.thresholdReached.get(votingRoundId)!.get(protocolId)!.set(messageHash, sortedList.length);
          this.queue.push({
            votingRoundId,
            protocolId,
            messageHash
          });
        }
      }
    }
  }

}
