import { Inject, Injectable, Logger } from "@nestjs/common";
import { SubProtocol2 } from "../../../old/src/TopLevelRunner";
import { EpochData, BareSignature, RewardOffered } from "../../../libs/ftso-core/src/voting-types";
import { PriceService } from "./price-feeds/price.service";
import { ConfigService } from "@nestjs/config";
import { EntityManager } from "typeorm";
import { IndexerClient } from "../../../libs/ftso-core/src/IndexerClient";
import { EpochSettings } from "../../../libs/ftso-core/src/utils/EpochSettings";
import BN from "bn.js";
import { calculateResults, rewardEpochFeedSequence } from "../../../libs/ftso-core/src/price-calculation";
import { Bytes32 } from "../../../libs/ftso-core/src/utils/sol-types";
import { ZERO_ADDRESS, ZERO_BYTES32, hashForCommit, packPrices } from "../../../libs/ftso-core/src/utils/voting-utils";
import { signMessage } from "./utils/web3";
import Web3 from "web3";

const NON_EXISTENT_PRICE = 0;

@Injectable()
export class FtsoCalculatorService implements SubProtocol2 {
  private readonly logger = new Logger(FtsoCalculatorService.name);
  private readonly epochSettings: EpochSettings;
  private readonly indexerClient: IndexerClient;
  protocolId: number;

  private readonly epochData = new Map<number, EpochData>();

  private readonly myAddrres: string = ZERO_ADDRESS;
  private readonly myKey = Bytes32.random();

  constructor(
    @Inject("PRICE_SERVICE") private readonly priceService: PriceService,
    manager: EntityManager,
    configService: ConfigService
  ) {
    this.epochSettings = configService.get<EpochSettings>("epochSettings");
    this.indexerClient = new IndexerClient(manager, this.epochSettings);
  }

  async getCommit(epochId: number): Promise<string> {
    const rewardEpochId = this.epochSettings.rewardEpochIdForPriceEpochId(epochId);
    const offers = await this.indexerClient.getRewardOffers(rewardEpochId);
    if (offers.length === 0) {
      this.logger.error("No offers found for reward epoch: ", rewardEpochId);
    }

    const data = await this.getPricesForEpoch(epochId, offers);
    const hash = hashForCommit(this.myAddrres, data.random.value, data.merkleRoot, data.pricesHex);
    this.epochData.set(epochId, data);
    return hash;
  }

  private async getPricesForEpoch(priceEpochId: number, rewardOffers: RewardOffered[]): Promise<EpochData> {
    const feedSequence = rewardEpochFeedSequence(rewardOffers);

    const prices = feedSequence.map(feed => this.priceService.getPrice(feed) ?? NON_EXISTENT_PRICE);
    const data: EpochData = {
      epochId: priceEpochId,
      merkleRoot: ZERO_BYTES32,
      prices: prices,
      pricesHex: packPrices(prices),
      random: Bytes32.random(),
      bitVote: "0x00",
    };
    return data;
  }

  async getReveal(epochId: number): Promise<EpochData> {
    return Promise.resolve(this.epochData.get(epochId));
  }

  async getResult(epochId: number): Promise<[string, BareSignature]> {
    const rewardEpochId = this.epochSettings.rewardEpochIdForPriceEpochId(epochId);
    const offers = await this.indexerClient.getRewardOffers(rewardEpochId);

    const commits = await this.indexerClient.queryCommits(epochId);
    const fakeWeights = new Map<string, BN>();
    for (const commit of commits) {
      fakeWeights.set(commit[0], new BN(1));
    }
    const reveals = await this.indexerClient.queryReveals(epochId);
    const res = await calculateResults(epochId, commits, reveals, offers, fakeWeights);
    const sig = signMessage(new Web3(), res.merkleRoot.toString(), this.myKey.toString());
    return [res.merkleRoot.toString(), sig];
  }
}
