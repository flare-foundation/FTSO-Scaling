import { Logger } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { IProtocolMessageMerkleRoot, ProtocolMessageMerkleRoot } from "../../libs/fsp-utils/src/ProtocolMessageMerkleRoot";
import { DataAvailabilityStatus, DataManager } from "../../libs/ftso-core/src/DataManager";
import { IndexerClient } from "../../libs/ftso-core/src/IndexerClient";
import { RewardEpochManager } from "../../libs/ftso-core/src/RewardEpochManager";
import { FTSO2_PROTOCOL_ID, RANDOM_GENERATION_BENCHING_WINDOW } from "../../libs/ftso-core/src/configs/networks";
import { calculateResultsForVotingRound } from "../../libs/ftso-core/src/ftso-calculation/ftso-calculation-logic";
import { errorString } from "../../libs/ftso-core/src/utils/error";
import { EpochResult } from "../../libs/ftso-core/src/voting-types";
import { ECDSASignature } from "../../libs/fsp-utils/src/ECDSASignature";
import { ISignaturePayload, SignaturePayload } from "../../libs/fsp-utils/src/SignaturePayload";
import { PayloadMessage } from "../../libs/fsp-utils/src/PayloadMessage";
import Web3 from "web3";

const web3 = new Web3("https://dummy");

export class MiniFtsoCalculator {
  logger = new Logger("mini-ftso-calculator");
  voterIndex: number;
  privateKey: string;
  // connections to the indexer and price provider
  private readonly indexerClient: IndexerClient;

  private readonly rewardEpochManger: RewardEpochManager;
  private readonly dataManager: DataManager;

  // Indexer top timeout margin
  private readonly indexer_top_timeout: number;

  constructor(voterIndex: number, privateKey: string, manager: EntityManager) {
    this.voterIndex = voterIndex;
    this.privateKey = privateKey;
    this.indexerClient = new IndexerClient(manager, 0);
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

  private async prepareCalculationResultData(votingRoundId: number): Promise<EpochResult | undefined> {
    const dataResponse = await this.dataManager.getDataForCalculations(
      votingRoundId,
      RANDOM_GENERATION_BENCHING_WINDOW,
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

  public async getSignaturePayload(votingRoundId: number): Promise<string> {
    let result = await this.prepareCalculationResultData(votingRoundId);
    const merkleRoot = result.merkleTree.root;
    const message: IProtocolMessageMerkleRoot = {
      protocolId: FTSO2_PROTOCOL_ID,
      votingRoundId,
      isSecureRandom: result.randomData.isSecure,
      merkleRoot,
    };
    let messageToSign = ProtocolMessageMerkleRoot.encode(message);
    let unsignedMessage = "";
    const messageHash = web3.utils.keccak256(messageToSign)
    const signaturePayload = {
      type: "0x00",
      message,
      signature: await ECDSASignature.signMessageHash(messageHash, this.privateKey),
      unsignedMessage
    } as ISignaturePayload;
    return PayloadMessage.encode({
      protocolId: message.protocolId,
      votingRoundId: message.votingRoundId,
      payload: SignaturePayload.encode(signaturePayload)
    })
  }
}
