import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EntityManager } from "typeorm";
import { Bytes32 } from "../../../libs/ftso-core/src/utils/sol-types";
import Web3 from "web3";
import { IndexerClient } from "../../../libs/ftso-core/src/IndexerClient";
import { rewardEpochFeedSequence, calculateResults } from "../../../libs/ftso-core/src/price-calculation";
import { EpochSettings } from "../../../libs/ftso-core/src/utils/EpochSettings";
import { hashForCommit, packPrices } from "../../../libs/ftso-core/src/utils/voting-utils";
import { EpochData, RevealData, RewardOffered } from "../../../libs/ftso-core/src/voting-types";
import { PriceService } from "./price-feeds/price.service";
import { sleepFor } from "./utils/time";

const NON_EXISTENT_PRICE = 0;
const web3Helper = new Web3();

@Injectable()
export class FtsoCalculatorService {
  private readonly logger = new Logger(FtsoCalculatorService.name);
  private readonly epochSettings: EpochSettings;
  private readonly indexerClient: IndexerClient;

  // TODO: Need to clean up old epoch data so the map doesn't grow indefinitely
  private readonly dataByEpoch = new Map<number, EpochData>();

  constructor(
    @Inject("PRICE_SERVICE")
    private readonly priceService: PriceService,
    manager: EntityManager,
    configService: ConfigService
  ) {
    this.epochSettings = configService.get<EpochSettings>("epochSettings")!;
    this.indexerClient = new IndexerClient(manager, this.epochSettings);
  }

  async getCommit(epochId: number, signingAddress: string): Promise<string> {
    const rewardEpochId = this.epochSettings.rewardEpochForVotingEpoch(epochId);
    const offers = await this.indexerClient.getRewardOffers(rewardEpochId);
    if (offers.length === 0) {
      this.logger.error("No offers found for reward epoch: ", rewardEpochId);
    }

    const data = await this.getPricesForEpoch(epochId, offers);
    const hash = hashForCommit(signingAddress, data.random.value, data.priceHex);
    this.dataByEpoch.set(epochId, data);
    this.logger.log(`Commit for epoch ${epochId}: ${hash}`);
    return hash;
  }

  private async getPricesForEpoch(priceEpochId: number, rewardOffers: RewardOffered[]): Promise<EpochData> {
    const feedSequence = rewardEpochFeedSequence(rewardOffers);

    const prices = feedSequence.map(feed => this.priceService.getPrice(feed) ?? NON_EXISTENT_PRICE);
    const data: EpochData = {
      priceHex: packPrices(prices),
      random: Bytes32.random(),
    };
    return data;
  }

  async getReveal(epochId: number): Promise<RevealData | undefined> {
    this.logger.log(`Getting reveal for epoch ${epochId}`);
 
    const epochData = this.dataByEpoch.get(epochId)!;
    if (epochData === undefined) {
      // TODO: Query indexer if not found - for usecases that are replaying history
      //       Note: same should be done for getCommit.
      this.logger.error(`No data found for epoch ${epochId}`);
      return undefined;
    }
    const revealData: RevealData = {
      random: epochData.random.toString(),
      encodedPrices: epochData.priceHex,
    };

    return revealData;
  }

  async getResult(epochId: number): Promise<[Bytes32, boolean]> {
    // TODO: Added sleep here because the system client calls this before the reveals are properly indexed - need to sort this race condition out.
    await sleepFor(1000); 
    const rewardEpochId = this.epochSettings.rewardEpochForVotingEpoch(epochId);
    const offers = await this.indexerClient.getRewardOffers(rewardEpochId);
    const commits = await this.indexerClient.queryCommits(epochId);
    const reveals = await this.indexerClient.queryReveals(epochId);
    const weights = await this.indexerClient.getVoterWeights(epochId);
    const result = await calculateResults(epochId, commits, reveals, offers, weights);
    return [result.merkleRoot, result.randomQuality == 0];
  }
}
