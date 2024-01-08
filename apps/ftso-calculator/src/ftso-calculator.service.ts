import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EntityManager } from "typeorm";
import { Bytes32 } from "../../../libs/ftso-core/src/utils/sol-types";
import Web3 from "web3";
import { IndexerClient } from "../../../libs/ftso-core/src/IndexerClient";
import { rewardEpochFeedSequence, calculateResults } from "../../../libs/ftso-core/src/price-calculation";
import { EpochSettings } from "../../../libs/ftso-core/src/utils/EpochSettings";
import { hashForCommit, packPrices } from "../../../libs/ftso-core/src/utils/voting-utils";
import { EpochData, RewardOffered } from "../../../libs/ftso-core/src/voting-types";
import { PriceService } from "./price-feeds/price.service";
import { getAddress } from "./utils/web3";
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

  private readonly myAddrres: string;
  private readonly myKey: Bytes32;

  constructor(
    @Inject("PRICE_SERVICE")
    private readonly priceService: PriceService,
    manager: EntityManager,
    configService: ConfigService
  ) {
    this.epochSettings = configService.get<EpochSettings>("epochSettings")!;
    this.indexerClient = new IndexerClient(manager, this.epochSettings);
    this.myKey = Bytes32.fromHexString(configService.get<string>("privateKey")!);
    this.myAddrres = getAddress(web3Helper, this.myKey.toString());

    setTimeout(() => {
      this.test();
    }, 1000);
  }

  async test(): Promise<void> {
    while (true) {
      const epochId = this.epochSettings.votingEpochForTime(Date.now()) - 1;

      const commit = await this.getCommit(epochId);
      const reveal = await this.getReveal(epochId);
      // const result = await this.getResult(epochId);

      console.log(`Commit for epoch ${epochId}: ${commit}`);
      console.log(`Reveal for epoch ${epochId}: ${JSON.stringify(reveal)}`);

      await sleepFor(this.epochSettings.votingEpochDurationSec * 1000);
    }
  }

  async getCommit(epochId: number): Promise<string> {
    const rewardEpochId = this.epochSettings.rewardEpochForVotingEpoch(epochId);
    const offers = await this.indexerClient.getRewardOffers(rewardEpochId);
    if (offers.length === 0) {
      this.logger.error("No offers found for reward epoch: ", rewardEpochId);
    }

    const data = await this.getPricesForEpoch(epochId, offers);
    const hash = hashForCommit(this.myAddrres, data.random.value, data.priceHex);
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

  async getReveal(epochId: number): Promise<EpochData | undefined> {
    this.logger.log(`Getting reveal for epoch ${epochId}: ${this.dataByEpoch.get(epochId)}`);
    return Promise.resolve(this.dataByEpoch.get(epochId));
  }

  async getResult(epochId: number): Promise<string> {
    const rewardEpochId = this.epochSettings.rewardEpochForVotingEpoch(epochId);
    const offers = await this.indexerClient.getRewardOffers(rewardEpochId);

    const commits = await this.indexerClient.queryCommits(epochId);

    const reveals = await this.indexerClient.queryReveals(epochId);

    const weights = await this.indexerClient.getVoterWeights(epochId);

    const result = await calculateResults(epochId, commits, reveals, offers, weights);
    return result.merkleRoot.toString();
  }
}
