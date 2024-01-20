import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EntityManager } from "typeorm";
import Web3 from "web3";
import { IndexerClient } from "../../../libs/ftso-core/src/IndexerClient";
import { RewardEpochManager } from "../../../libs/ftso-core/src/RewardEpochManager";
import { FTSO2_PROTOCOL_ID, RANDOM_GENERATION_BENCHING_WINDOW } from "../../../libs/ftso-core/src/configs/networks";
import { calculateResults } from "../../../libs/ftso-core/src/ftso-calculation-logic";
import { CommitData, ICommitData } from "../../../libs/ftso-core/src/utils/CommitData";
import { EpochSettings } from "../../../libs/ftso-core/src/utils/EpochSettings";
import { FeedValueEncoder } from "../../../libs/ftso-core/src/utils/FeedEncoder";
import { IPayloadMessage, PayloadMessage } from "../../../libs/ftso-core/src/utils/PayloadMessage";
import { IRevealData, RevealData } from "../../../libs/ftso-core/src/utils/RevealData";
import { Bytes32 } from "../../../libs/ftso-core/src/utils/sol-types";
import { Feed } from "../../../libs/ftso-core/src/voting-types";
import { Api } from "./price-provider-api/generated/provider-api";
import { IProtocolMessageMerkleRoot, ProtocolMessageMerkleRoot } from "../../../libs/ftso-core/src/utils/ProtocolMessageMerkleRoot";
import { errorString } from "../../../libs/ftso-core/src/utils/error";
import { DataAvailabilityStatus, DataManager } from "../../../libs/ftso-core/src/DataManager";


const supportedFeeds = [
  "0x4254430055534454", // BTC USDT
  "0x4554480055534454", // ETH USDT
  "0x464c520055534454"  // FLR USDT
]

const NON_EXISTENT_PRICE = 0;
const web3Helper = new Web3();

@Injectable()
export class FtsoCalculatorService {
  private readonly logger = new Logger(FtsoCalculatorService.name);

  // connections to the indexer and price provider
  private readonly indexerClient: IndexerClient;
  private readonly priceProviderClient: Api<unknown>;

  // epoch settings configuration
  private readonly epochSettings: EpochSettings;

  // TODO: Need to clean up old epoch data so the map doesn't grow indefinitely
  private readonly votingRoundToRevealData = new Map<number, IRevealData>();

  private rewardEpochManger: RewardEpochManager;
  private dataManager: DataManager;

  // Indexer top timeout margin
  private indexer_top_timeout: number;

  constructor(
    manager: EntityManager,
    configService: ConfigService
  ) {
    this.epochSettings = configService.get<EpochSettings>("epochSettings")!;
    const required_history_sec = configService.get<number>("required_indexer_history_time_sec");
    this.indexer_top_timeout = configService.get<number>("indexer_top_timeout");
    this.indexerClient = new IndexerClient(manager, required_history_sec);
    this.rewardEpochManger = new RewardEpochManager(this.indexerClient);
    this.priceProviderClient = new Api({ baseURL: configService.get<string>("price_provider_url") });
    this.dataManager = new DataManager(this.indexerClient, this.rewardEpochManger);    
  }

  // Entry point methods for the protocol data provider

  async getEncodedCommitData(votingRoundId: number, submissionAddress: string): Promise<string> {
    const rewardEpoch = await this.rewardEpochManger.getRewardEpoch(votingRoundId);
    const revealData = await this.getPricesForEpoch(votingRoundId, rewardEpoch.canonicalFeedOrder);
    const hash = CommitData.hashForCommit(submissionAddress, revealData.random, revealData.encodedValues);
    const commitData = {
      commitHash: hash,
    } as ICommitData;
    this.votingRoundToRevealData.set(votingRoundId, revealData);
    this.logger.log(`Commit for voting round ${votingRoundId}: ${hash}`);
    const msg: IPayloadMessage<string> = {
      protocolId: FTSO2_PROTOCOL_ID,
      votingRoundId,
      payload: CommitData.encode(commitData),
    };
    return PayloadMessage.encode(msg);
  }

  async getEncodedRevealData(votingRoundId: number): Promise<string> {
    this.logger.log(`Getting reveal for voting round ${votingRoundId}`);

    const revealData = this.votingRoundToRevealData.get(votingRoundId)!;
    if (revealData === undefined) {
      // we do not have reveal data. Either we committed and restarted the client, hence lost the reveal data irreversibly
      // or we did not commit at all.
      this.logger.error(`No reveal data found for epoch ${votingRoundId}`);
      return undefined;
    }

    const msg: IPayloadMessage<string> = {
      protocolId: FTSO2_PROTOCOL_ID,
      votingRoundId: votingRoundId,
      payload: RevealData.encode(revealData),
    };
    return PayloadMessage.encode(msg);
  }

  async getEncodedResultData(votingRoundId: number): Promise<string> {   
    const dataResponse = await this.dataManager.getDataForCalculations(votingRoundId, RANDOM_GENERATION_BENCHING_WINDOW, this.indexer_top_timeout);
    if(dataResponse.status !== DataAvailabilityStatus.NOT_OK) {
      this.logger.error(`Data not available for epoch ${votingRoundId}`);
      return ""; // TODO: ok?
    }
    try {
      const result = await calculateResults(dataResponse.data);
      const message = {
        protocolId: FTSO2_PROTOCOL_ID,
        votingRoundId,
        randomQualityScore: result.randomQuality,
        merkleRoot: result.merkleRoot.toString()
      } as IProtocolMessageMerkleRoot;
      return ProtocolMessageMerkleRoot.encode(message);
    } catch (e) {
      this.logger.error(`Error calculating result: ${errorString(e)}`);
      throw new InternalServerErrorException(`Unable to calculate result for epoch ${votingRoundId}`, { cause: e });
    }
  }

  // async getResult(votingRoundId: number): Promise<string> {
  //   this.logger.log(`Getting result for epoch ${votingRoundId}`);
  //   try {
  //     const [merkleRoot, goodRandom] = await this.ftsoCalculatorService.getResult(votingRoundId);
  //     const encoded = // 38 bytes total
  //       "0x" +
  //       FTSO2_PROTOCOL_ID.toString(16).padStart(2, "0") + // 2 bytes
  //       votingRoundId.toString(16).padStart(8, "0") + // 4 bytes
  //       (goodRandom ? "01" : "00") + // 1 byte
  //       merkleRoot.toString().slice(2); // 32 bytes

  //     this.logger.log(`Result for epoch ${votingRoundId}: ${encoded}`);
  //     return encoded;
  //   } catch (e) {
  //     this.logger.error(`Error calculating result: ${errorString(e)}`);
  //     throw new InternalServerErrorException(`Unable to calculate result for epoch ${votingRoundId}`, { cause: e });
  //   }
  // }



  // Internal methods

  private async getPricesForEpoch(votingRoundId: number, supportedFeeds: Feed[]): Promise<IRevealData> {

    // TODO: do some retries here
    const pricesRes = await this.priceProviderClient.priceProviderApi.getPriceFeeds(
      votingRoundId,
      { feeds: supportedFeeds.map(feed => feed.name) },
    );

    // This should just be a warning
    if (200 <= pricesRes.status && pricesRes.status < 300) {
      this.logger.warn(`Failed to get prices for epoch ${votingRoundId}: ${pricesRes.data}`);
      // TODO: exit
      throw new Error(`Failed to get prices for epoch ${votingRoundId}: ${pricesRes.data}`);
    }

    const prices = pricesRes.data;

    // transfer prices to 4 byte hex strings and concatenate them
    // make sure that the order of prices is in line with protocol definition
    const extractedPrices = prices.feedPriceData.map(pri => pri.price);

    const data: IRevealData = {
      prices: extractedPrices,
      feeds: supportedFeeds,
      random: Bytes32.random().toString(),
      encodedValues: FeedValueEncoder.encode(extractedPrices, supportedFeeds),
    };
    return data;
  }


}



