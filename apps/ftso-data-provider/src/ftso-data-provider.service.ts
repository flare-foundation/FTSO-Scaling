import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LRUCache } from "lru-cache";
import { EntityManager } from "typeorm";
import { IPayloadMessage } from "../../../libs/ftso-core/src/fsp-utils/PayloadMessage";
import {
  IProtocolMessageMerkleData,
  IProtocolMessageMerkleRoot,
} from "../../../libs/ftso-core/src/fsp-utils/ProtocolMessageMerkleRoot";
import { DataAvailabilityStatus, DataManager } from "../../../libs/ftso-core/src/DataManager";
import { IndexerClient } from "../../../libs/ftso-core/src/IndexerClient";
import { RewardEpochManager } from "../../../libs/ftso-core/src/RewardEpochManager";
import { ContractMethodNames } from "../../../libs/contracts/src/definitions";
import { FTSO2_PROTOCOL_ID, RANDOM_GENERATION_BENCHING_WINDOW } from "../../../libs/ftso-core/src/constants";
import { calculateResultsForVotingRound } from "../../../libs/ftso-core/src/ftso-calculation/ftso-calculation-logic";
import { CommitData, ICommitData } from "../../../libs/ftso-core/src/data/CommitData";
import { FeedValueEncoder } from "../../../libs/ftso-core/src/data/FeedValueEncoder";
import { FeedResultWithProof, MerkleTreeStructs } from "../../../libs/ftso-core/src/data/MerkleTreeStructs";
import { IRevealData } from "../../../libs/ftso-core/src/data/RevealData";
import { errorString } from "../../../libs/ftso-core/src/utils/error";
import { retry, RetryError } from "../../../libs/ftso-core/src/utils/retry";
import { Bytes32 } from "../../../libs/ftso-core/src/utils/sol-types";
import { EpochResult, Feed, MedianCalculationResult } from "../../../libs/ftso-core/src/voting-types";
import { JSONAbiDefinition } from "./dto/data-provider-responses.dto";
import { Api, FeedId, FeedValuesResponse } from "./feed-value-provider-api/generated/provider-api";

import { RewardEpoch } from "../../../libs/ftso-core/src/RewardEpoch";
import { AbiCache } from "../../../libs/contracts/src/abi/AbiCache";
import { CONTRACTS } from "../../../libs/contracts/src/constants";
import { AxiosResponse } from "axios";

type RoundAndAddress = string;

@Injectable()
export class FtsoDataProviderService {
  private readonly logger = new Logger(FtsoDataProviderService.name);

  // connections to the indexer and feed value provider
  private readonly indexerClient: IndexerClient;
  private readonly feedValueProviderClient: Api<unknown>;
  private readonly votingRoundData: LRUCache<RoundAndAddress, IRevealData>;

  private readonly rewardEpochManager: RewardEpochManager;
  private readonly dataManager: DataManager;
  private readonly encodingUtils = AbiCache.instance;

  // Indexer top timeout margin
  private readonly indexer_top_timeout: number;

  constructor(manager: EntityManager, configService: ConfigService) {
    const required_history_sec = configService.get<number>("required_indexer_history_time_sec");
    this.indexer_top_timeout = configService.get<number>("indexer_top_timeout");
    this.indexerClient = new IndexerClient(manager, required_history_sec, new Logger(IndexerClient.name));
    this.rewardEpochManager = new RewardEpochManager(this.indexerClient);
    this.feedValueProviderClient = new Api({ baseURL: configService.get<string>("value_provider_url") });
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

    const data = await this.getFeedValuesForEpoch(votingRoundId, rewardEpoch.canonicalFeedOrder);
    this.logger.debug(
      `Got fresh voting round data for ${votingRoundId}: ${submissionAddress} ${data.random} ${data.encodedValues}`
    );
    this.votingRoundData.set(combine(votingRoundId, submissionAddress), data);
    return data;
  }

  getRevealData(votingRoundId: number, submissionAddress: string): IPayloadMessage<IRevealData> | undefined {
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
      ...result.medianData.map((result) => MerkleTreeStructs.fromMedianCalculationResult(result)),
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

  async getFeedWithProof(votingRoundId: number, feedId: string): Promise<FeedResultWithProof | undefined> {
    const result = await this.prepareCalculationResultData(votingRoundId);
    if (result === undefined) {
      return undefined;
    }
    const feed = result.medianData.find((median) => median.feed.id === feedId);
    if (feed === undefined) {
      return undefined;
    }
    const proof = result.merkleTree.getProof(MerkleTreeStructs.hashMedianCalculationResult(feed));
    const response: FeedResultWithProof = {
      body: MerkleTreeStructs.fromMedianCalculationResult(feed),
      proof,
    };
    return response;
  }

  async getFullMedianData(votingRoundId: number): Promise<MedianCalculationResult[] | undefined> {
    const result = await this.prepareCalculationResultData(votingRoundId);
    if (result === undefined) {
      return undefined;
    }
    return result.medianData;
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

  private async getFeedValuesForEpoch(votingRoundId: number, supportedFeeds: Feed[]): Promise<IRevealData> {
    let response: AxiosResponse<FeedValuesResponse, unknown>;

    try {
      response = await retry(
        async () =>
          await this.feedValueProviderClient.feedValueProviderApi.getFeedValues(votingRoundId, {
            feeds: supportedFeeds.map((feed) => decodeFeed(feed.id)),
          })
      );
    } catch (e) {
      if (e instanceof RetryError) {
        throw new Error(
          `Failed to get feed values for epoch ${votingRoundId}, error connecting to value provider:\n${e.cause as Error}`
        );
      }
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Failed to get feed values for epoch ${votingRoundId}: ${JSON.stringify(response.data)}`);
    }

    const values = response.data;

    // transfer values to 4 byte hex strings and concatenate them
    // make sure that the order of values is in line with protocol definition
    const extractedValues = values.data.map((d) => d.value);

    return {
      values: extractedValues,
      feeds: supportedFeeds,
      random: Bytes32.random().toString(),
      encodedValues: FeedValueEncoder.encode(extractedValues, supportedFeeds),
    };
  }
}

// Helpers

function combine(round: number, address: string): RoundAndAddress {
  return [round, address].toString();
}

function decodeFeed(feedIdHex: string): FeedId {
  feedIdHex = unPrefix0x(feedIdHex);
  if (feedIdHex.length !== 42) {
    throw new Error(`Invalid feed string: ${feedIdHex}`);
  }

  const category = parseInt(feedIdHex.slice(0, 2));
  const name = Buffer.from(feedIdHex.slice(2), "hex").toString("utf8").replaceAll("\0", "");
  return { category, name };
}

function unPrefix0x(tx: string) {
  if (!tx) {
    return "0x0";
  } else if (tx.startsWith("0x") || tx.startsWith("0X")) {
    return tx.slice(2);
  } else if (tx.startsWith("-0x") || tx.startsWith("-0X")) {
    return tx.slice(3);
  }
  return tx;
}
