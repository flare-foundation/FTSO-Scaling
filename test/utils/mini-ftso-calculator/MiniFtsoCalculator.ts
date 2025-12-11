import { EntityManager } from "typeorm";
import Web3 from "web3";
import { ECDSASignature } from "../../../libs/ftso-core/src/fsp-utils/ECDSASignature";
import { PayloadMessage } from "../../../libs/ftso-core/src/fsp-utils/PayloadMessage";
import {
  IProtocolMessageMerkleRoot,
  ProtocolMessageMerkleRoot,
} from "../../../libs/ftso-core/src/fsp-utils/ProtocolMessageMerkleRoot";
import { ISignaturePayload, SignaturePayload } from "../../../libs/ftso-core/src/fsp-utils/SignaturePayload";
import { DataAvailabilityStatus, DataManager } from "../../../libs/ftso-core/src/DataManager";
import { IndexerClient } from "../../../libs/ftso-core/src/IndexerClient";
import { RewardEpochManager } from "../../../libs/ftso-core/src/RewardEpochManager";
import {
  EPOCH_SETTINGS,
  FTSO2_PROTOCOL_ID,
  RANDOM_GENERATION_BENCHING_WINDOW,
} from "../../../libs/ftso-core/src/constants";
import { calculateResultsForVotingRound } from "../../../libs/ftso-core/src/ftso-calculation/ftso-calculation-logic";
import { errorString } from "../../../libs/ftso-core/src/utils/error";
import { EpochResult } from "../../../libs/ftso-core/src/voting-types";
import { ILogger } from "../../../libs/ftso-core/src/utils/ILogger";

const web3 = new Web3("https://dummy");

export class MiniFtsoCalculator {
  voterIndex: number;
  privateKey: string;
  // connections to the indexer and feed value provider
  private readonly indexerClient: IndexerClient;

  private readonly rewardEpochManger: RewardEpochManager;
  private readonly dataManager: DataManager;

  // Indexer top timeout margin
  private readonly indexer_top_timeout: number;
  private logger: ILogger;

  constructor(voterIndex: number, privateKey: string, manager: EntityManager, logger: ILogger) {
    this.voterIndex = voterIndex;
    this.privateKey = privateKey;
    this.logger = logger;
    const requiredHistoryTimeSec =
      2 * EPOCH_SETTINGS().rewardEpochDurationInVotingEpochs * EPOCH_SETTINGS().votingEpochDurationSeconds;
    this.indexerClient = new IndexerClient(manager, requiredHistoryTimeSec, this.logger);
    this.rewardEpochManger = new RewardEpochManager(this.indexerClient);
    this.dataManager = new DataManager(this.indexerClient, this.rewardEpochManger, this.logger);
  }

  async getResultData(votingRoundId: number): Promise<IProtocolMessageMerkleRoot | undefined> {
    const result = await this.prepareCalculationResultData(votingRoundId);
    if (result === undefined) {
      return undefined;
    }
    const merkleRoot = result.merkleTree.root;
    const message: IProtocolMessageMerkleRoot = {
      protocolId: FTSO2_PROTOCOL_ID,
      votingRoundId,
      isSecureRandom: result.randomData.isSecure,
      merkleRoot,
    };
    return message;
  }

  public async prepareCalculationResultData(votingRoundId: number): Promise<EpochResult | undefined> {
    const dataResponse = await this.dataManager.getDataForCalculations(
      votingRoundId,
      RANDOM_GENERATION_BENCHING_WINDOW(),
      this.indexer_top_timeout
    );
    if (dataResponse.status !== DataAvailabilityStatus.OK) {
      this.logger.error(`Data not available for epoch ${votingRoundId}`);
      return undefined;
    }
    try {
      return calculateResultsForVotingRound(dataResponse.data);
    } catch (e) {
      this.logger.error(`Error calculating result: ${errorString(e)}`);
      // Ignore
    }
  }

  public async getSignaturePayload(
    votingRoundId: number,
    doubleSignRandom = false,
    providedEpochResult?: EpochResult
  ): Promise<string> {
    const result = providedEpochResult ?? (await this.prepareCalculationResultData(votingRoundId));
    const merkleRoot = doubleSignRandom ? Web3.utils.randomHex(32) : result.merkleTree.root;

    const message: IProtocolMessageMerkleRoot = {
      protocolId: FTSO2_PROTOCOL_ID,
      votingRoundId,
      isSecureRandom: result.randomData.isSecure,
      merkleRoot,
    };
    const messageToSign = ProtocolMessageMerkleRoot.encode(message);
    const unsignedMessage = "";
    const messageHash = web3.utils.keccak256(messageToSign);
    const signaturePayload = {
      type: "0x00",
      message,
      signature: ECDSASignature.signMessageHash(messageHash, this.privateKey),
      unsignedMessage,
    } as ISignaturePayload;
    return PayloadMessage.encode({
      protocolId: message.protocolId,
      votingRoundId: message.votingRoundId,
      payload: SignaturePayload.encode(signaturePayload),
    });
  }
}
