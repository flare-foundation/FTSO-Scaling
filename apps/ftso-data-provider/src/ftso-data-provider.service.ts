import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LRUCache } from "lru-cache";
import { EntityManager } from "typeorm";
import { IPayloadMessage } from "../../../libs/fsp-utils/src/PayloadMessage";
import {
  IProtocolMessageMerkleData,
  IProtocolMessageMerkleRoot,
} from "../../../libs/fsp-utils/src/ProtocolMessageMerkleRoot";
import { DataAvailabilityStatus, DataManager } from "../../../libs/ftso-core/src/DataManager";
import { IndexerClient } from "../../../libs/ftso-core/src/IndexerClient";
import { RewardEpochManager } from "../../../libs/ftso-core/src/RewardEpochManager";
import { ContractMethodNames } from "../../../libs/ftso-core/src/configs/contracts";
import {
  CONTRACTS,
  FTSO2_PROTOCOL_ID,
  RANDOM_GENERATION_BENCHING_WINDOW,
} from "../../../libs/ftso-core/src/configs/networks";
import { calculateResultsForVotingRound } from "../../../libs/ftso-core/src/ftso-calculation/ftso-calculation-logic";
import { CommitData, ICommitData } from "../../../libs/ftso-core/src/utils/CommitData";
import { EncodingUtils } from "../../../libs/ftso-core/src/utils/EncodingUtils";
import { FeedValueEncoder } from "../../../libs/ftso-core/src/utils/FeedValueEncoder";
import { MerkleTreeStructs } from "../../../libs/ftso-core/src/utils/MerkleTreeStructs";
import { IRevealData } from "../../../libs/ftso-core/src/utils/RevealData";
import { errorString } from "../../../libs/ftso-core/src/utils/error";
import { retry } from "../../../libs/ftso-core/src/utils/retry";
import { Bytes32 } from "../../../libs/ftso-core/src/utils/sol-types";
import { EpochResult, Feed } from "../../../libs/ftso-core/src/voting-types";
import { JSONAbiDefinition } from "./dto/data-provider-responses.dto";
import { Api } from "./price-provider-api/generated/provider-api";

import { RewardEpoch } from "../../../libs/ftso-core/src/RewardEpoch";

type RoundAndAddress = string;

@Injectable()
export class FtsoDataProviderService {
  private readonly logger = new Logger(FtsoDataProviderService.name);

  // connections to the indexer and price provider
  private readonly indexerClient: IndexerClient;
  private readonly priceProviderClient: Api<unknown>;
  private readonly votingRoundData: LRUCache<RoundAndAddress, IRevealData>;

  private readonly rewardEpochManager: RewardEpochManager;
  private readonly dataManager: DataManager;
  private readonly encodingUtils = EncodingUtils.instance;

  // Indexer top timeout margin
  private readonly indexer_top_timeout: number;

  constructor(manager: EntityManager, configService: ConfigService) {
    const required_history_sec = configService.get<number>("required_indexer_history_time_sec");
    this.indexer_top_timeout = configService.get<number>("indexer_top_timeout");
    this.indexerClient = new IndexerClient(manager, required_history_sec, new Logger(IndexerClient.name));
    this.rewardEpochManager = new RewardEpochManager(this.indexerClient);
    this.priceProviderClient = new Api({ baseURL: configService.get<string>("price_provider_url") });
    this.dataManager = new DataManager(this.indexerClient, this.rewardEpochManager, this.logger);
    this.votingRoundData = new LRUCache({
      max: configService.get<number>("voting_round_history_size"),
    });
  }

  // Entry point methods for the protocol data provider

  async getCommitData(
    votingRoundId: number,
    submissionAddress: string
  ): Promise<IPayloadMessage<ICommitData> | undefined> {
    const rewardEpoch = await this.rewardEpochManager.getRewardEpochForVotingEpochId(votingRoundId);
    const revealData = await this.calculateOrGetRoundData(votingRoundId, submissionAddress, rewardEpoch);
    const hash = CommitData.hashForCommit(
      submissionAddress,
      votingRoundId,
      revealData.random,
      revealData.encodedValues
    );
    const commitData: ICommitData = {
      commitHash: hash,
    };
    this.logger.log(`Commit for voting round ${votingRoundId}: ${hash}`);
    const msg: IPayloadMessage<ICommitData> = {
      protocolId: FTSO2_PROTOCOL_ID,
      votingRoundId,
      payload: commitData,
    };
    return msg;
  }

  private async calculateOrGetRoundData(votingRoundId: number, submissionAddress: string, rewardEpoch: RewardEpoch) {
    const cached = this.votingRoundData.get(combine(votingRoundId, submissionAddress));
    if (cached !== undefined) {
      this.logger.debug(
        `Returning cached voting round data for ${votingRoundId}: ${submissionAddress} ${cached.random} ${cached.encodedValues}`
      );
      return cached;
    }

    const data = await this.getPricesForEpoch(votingRoundId, rewardEpoch.canonicalFeedOrder);
    this.logger.debug(
      `Got fresh voting round data for ${votingRoundId}: ${submissionAddress} ${data.random} ${data.encodedValues}`
    );
    this.votingRoundData.set(combine(votingRoundId, submissionAddress), data);
    return data;
  }

  async getRevealData(
    votingRoundId: number,
    submissionAddress: string
  ): Promise<IPayloadMessage<IRevealData> | undefined> {
    this.logger.log(`Getting reveal for voting round ${votingRoundId}`);

    const revealData = this.votingRoundData.get(combine(votingRoundId, submissionAddress));
    if (revealData === undefined) {
      // we do not have reveal data. Either we committed and restarted the client, hence lost the reveal data irreversibly
      // or we did not commit at all.
      this.logger.error(`No reveal data found for epoch ${votingRoundId}`);
      return undefined;
    }

    const msg: IPayloadMessage<IRevealData> = {
      protocolId: FTSO2_PROTOCOL_ID,
      votingRoundId: votingRoundId,
      payload: revealData,
    };
    return msg;
  }

  async getResultData(votingRoundId: number): Promise<IProtocolMessageMerkleRoot | undefined> {
    const result = await this.prepareCalculationResultData(votingRoundId);
    if (result === undefined) {
      return undefined;
    }
    const merkleRoot = result.merkleTree.root;
    this.logger.log(`Computed merkle root for voting round ${votingRoundId}: ${merkleRoot}`);
    const message: IProtocolMessageMerkleRoot = {
      protocolId: FTSO2_PROTOCOL_ID,
      votingRoundId,
      isSecureRandom: result.randomData.isSecure,
      merkleRoot,
    };
    return message;
  }

  async getFullMerkleTree(votingRoundId: number): Promise<IProtocolMessageMerkleData | undefined> {
    const result = await this.prepareCalculationResultData(votingRoundId);
    if (result === undefined) {
      return undefined;
    }
    const merkleRoot = result.merkleTree.root;
    const treeNodes = [
      MerkleTreeStructs.fromRandomCalculationResult(result.randomData),
      ...result.medianData.map(result => MerkleTreeStructs.fromMedianCalculationResult(result)),
    ];
    const response: IProtocolMessageMerkleData = {
      protocolId: FTSO2_PROTOCOL_ID,
      votingRoundId,
      merkleRoot,
      isSecureRandom: result.randomData.isSecure,
      tree: treeNodes,
    };
    return response;
  }

  private async prepareCalculationResultData(votingRoundId: number): Promise<EpochResult | undefined> {
    const dataResponse = await this.dataManager.getDataForCalculations(
      votingRoundId,
      RANDOM_GENERATION_BENCHING_WINDOW(),
      this.indexer_top_timeout
    );
    if (
      dataResponse.status !== DataAvailabilityStatus.OK &&
      dataResponse.status !== DataAvailabilityStatus.TIMEOUT_OK
    ) {
      this.logger.error(`Data not available for epoch ${votingRoundId}`);
      return undefined;
    }
    try {
      return calculateResultsForVotingRound(dataResponse.data);
    } catch (e) {
      this.logger.error(`Error calculating result: ${errorString(e)}`);
      throw new InternalServerErrorException(`Unable to calculate result for epoch ${votingRoundId}`, { cause: e });
    }
  }

  getAbiDefinitions(): JSONAbiDefinition[] {
    const randomDef = this.encodingUtils.getFunctionInputAbiData(
      CONTRACTS.FtsoMerkleStructs.name,
      ContractMethodNames.randomStruct,
      0
    );
    const feedDef = this.encodingUtils.getFunctionInputAbiData(
      CONTRACTS.FtsoMerkleStructs.name,
      ContractMethodNames.feedStruct,
      0
    );
    const feedWithProof = this.encodingUtils.getFunctionInputAbiData(
      CONTRACTS.FtsoMerkleStructs.name,
      ContractMethodNames.feedWithProofStruct,
      0
    );
    return [
      { abiName: ContractMethodNames.randomStruct, data: randomDef },
      {
        abiName: ContractMethodNames.feedStruct,
        data: feedDef,
      },
      {
        abiName: ContractMethodNames.feedWithProofStruct,
        data: feedWithProof,
      },
    ];
  }

  // Internal methods

  private async getPricesForEpoch(votingRoundId: number, supportedFeeds: Feed[]): Promise<IRevealData> {
    const pricesRes = await retry(
      async () =>
        await this.priceProviderClient.priceProviderApi.getPriceFeeds(votingRoundId, {
          feeds: supportedFeeds.map(feed => feed.id),
        })
    );

    if (pricesRes.status < 200 || pricesRes.status >= 300) {
      throw new Error(`Failed to get prices for epoch ${votingRoundId}: ${pricesRes.data}`);
    }

    const prices = pricesRes.data;

    // transfer prices to 4 byte hex strings and concatenate them
    // make sure that the order of prices is in line with protocol definition
    const extractedPrices = prices.feedPriceData.map(pri => pri.price);

    return {
      prices: extractedPrices,
      feeds: supportedFeeds,
      random: Bytes32.random().toString(),
      encodedValues: FeedValueEncoder.encode(extractedPrices, supportedFeeds),
    };
  }
}

function combine(round: number, address: string): RoundAndAddress {
  return [round, address].toString();
}
