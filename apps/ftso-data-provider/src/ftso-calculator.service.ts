import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EntityManager } from "typeorm";
import Web3 from "web3";
import { IndexerClient } from "../../../libs/ftso-core/src/IndexerClient";
import { calculateResults, rewardEpochFeedSequence } from "../../../libs/ftso-core/src/ftso-calculation-logic";
import { EpochSettings } from "../../../libs/ftso-core/src/utils/EpochSettings";
import { FeedValueEncoder } from "../../../libs/ftso-core/src/utils/FeedEncoder";
import { Bytes32 } from "../../../libs/ftso-core/src/utils/sol-types";
import { hashForCommit } from "../../../libs/ftso-core/src/utils/voting-utils";
import { EpochData, Feed, RevealData } from "../../../libs/ftso-core/src/voting-types";
import { RewardOffers } from "@app/ftso-core/events/RewardOffers";
import { Api } from "./price-provider-api/generated/provider-api";
import { sleepFor } from "./utils/time";
import { RewardEpochManager } from "../../../libs/ftso-core/src/RewardEpochManager";


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
  private readonly dataByEpoch = new Map<number, EpochData>();
  
  private rewardEpochManger: RewardEpochManager;

  // Indexer top timeout margin
  private indexer_top_timeout: number;

  constructor(manager: EntityManager, configService: ConfigService, rewardEpochManager) {
    this.epochSettings = configService.get<EpochSettings>("epochSettings")!;
    const required_history_sec = configService.get<number>("required_indexer_history_time_sec");
    this.indexer_top_timeout = configService.get<number>("indexer_top_timeout");
    this.indexerClient = new IndexerClient(manager, required_history_sec);
    this.rewardEpochManger = new RewardEpochManager(this.indexerClient);
    this.priceProviderClient = new Api({ baseURL: configService.get<string>("price_provider_url") });
  }

  // Entry point methods for the protocol data provider

  async getCommit(votingRoundId: number, signingAddress: string): Promise<string> {
    const rewardEpoch = await this.rewardEpochManger.getRewardEpoch(votingRoundId);
    const data = await this.getPricesForEpoch(votingRoundId, rewardEpoch.canonicalFeedOrder);
    const hash = hashForCommit(signingAddress, data.random.value, data.priceHex);
    this.dataByEpoch.set(votingRoundId, data);
    this.logger.log(`Commit for epoch ${votingRoundId}: ${hash}`);
    return hash;
  }

  async getReveal(votingRoundId: number): Promise<RevealData | undefined> {
    this.logger.log(`Getting reveal for epoch ${votingRoundId}`);

    const epochData = this.dataByEpoch.get(votingRoundId)!;
    if (epochData === undefined) {
      // TODO: Query indexer if not found - for usecases that are replaying history
      //       Note: same should be done for getCommit.
      this.logger.error(`No data found for epoch ${votingRoundId}`);
      return undefined;
    }
    const revealData: RevealData = {
      random: epochData.random.toString(),
      encodedPrices: epochData.priceHex,
    };

    return revealData;
  }

  async getResult(votingRoundId: number): Promise<[Bytes32, boolean]> {
    const rewardEpoch = await this.rewardEpochManger.getRewardEpoch(votingRoundId);
    const revealResponse = await this.indexerClient.getSubmissionDataInRange("submit1", votingRoundId, votingRoundId, LUKA_CONST);
    const commitsResponse = await this.indexerClient.getSubmissionDataInRange("submit1", votingRoundId, votingRoundId, LUKA_CONST);

    commits = rewardEpoch.filterValidSubmitters(commits);

    // const commits = await this.indexerClient.queryCommits(votingRoundId);
    const reveals = await this.indexerClient.queryReveals(votingRoundId);
    const weights = await this.indexerClient.getVoterWeights(votingRoundId);
    const revealFails = await this.indexerClient.getRevealWithholders(votingRoundId);

    const result = await calculateResults(votingRoundId, commits, reveals, rewardEpoch.canonicalFeedOrder, weights, revealFails);
    return [result.merkleRoot, result.randomQuality];
  }

  // Internal methods

  private async getPricesForEpoch(votingRoundId: number, feedSequenc: Feed[]): Promise<EpochData> {

    // TODO: do some retries here
    const pricesRes = await this.priceProviderClient.priceProviderApi.getPriceFeeds(
      votingRoundId,
      { feeds: supportedFeeds },
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

    const data: EpochData = {
      priceHex: FeedValueEncoder.encode(extractedPrices),
      random: Bytes32.random(),
    };
    return data;
  }


}
