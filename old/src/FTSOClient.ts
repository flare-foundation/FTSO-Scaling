import BN from "bn.js";
import _ from "lodash";

import { EpochSettings } from "../../libs/ftso-core/src/utils/EpochSettings";
import {
  calculateFeedMedians,
  calculateResults,
  calculateRevealers,
  rewardEpochFeedSequence,
} from "../../libs/ftso-core/src/price-calculation";
import { IPriceProvider } from "../../libs/ftso-core/src/IPriceFeed";
import { IVotingProvider } from "../../libs/ftso-core/src/IVotingProvider";
import {
  EpochData,
  EpochResult,
  FinalizeData,
  MedianCalculationResult,
  RewardOffered,
  RewardClaim,
  RevealBitvoteData,
  SignatureData,
} from "../../libs/ftso-core/src/voting-types";
import {
  ZERO_BYTES32,
  feedId,
  hashForCommit,
  packPrices,
  toBN,
} from "../../libs/ftso-core/src/utils/voting-utils";
import { Bytes32 } from "../../libs/ftso-core/src/utils/sol-types";
import { asError } from "../../libs/ftso-core/src/utils/error";
import { calculateClaimsForPriceEpoch } from "../../libs/ftso-core/src/reward-calculation";
import { ILogger } from "../../libs/ftso-core/src/utils/ILogger";
import { IndexerClient } from "../../libs/ftso-core/src/IndexerClient";
import { SubProtocol } from "./TopLevelRunner";
import { recoverSigner } from "../../apps/ftso-calculator/src/utils/web3";
import Web3 from "web3";

const DEFAULT_VOTER_WEIGHT = 1000;
const NON_EXISTENT_PRICE = 0;

/**
 * A generic class for FTSO client implementation.
 * It supports pluggable price feeds and voting providers (Truffle for testing, Web3 for production).
 */
export class FTSOClient implements SubProtocol {
  private readonly priceProvidersByFeed = new Map<string, IPriceProvider>();

  get address() {
    return this.provider.senderAddressLowercase;
  }

  constructor(
    private readonly provider: IVotingProvider,
    private readonly index: IndexerClient,
    private readonly epochs: EpochSettings,
    priceProviders: IPriceProvider[] = [],
    private readonly logger: ILogger
  ) {
    this.registerPriceProviders(priceProviders);
  }

  // SubProtocol implementation
  readonly protocolId: number = 100;

  private lastEpochData: EpochData | undefined;

  async getCommit(epochId: number): Promise<string> {
    const data = await this.getPricesForEpoch(epochId);
    const hash = hashForCommit(
      this.address,
      data.random.value,
      data.merkleRoot,
      data.pricesHex
    );
    this.lastEpochData = data;
    return Promise.resolve(hash);
  }

  async getReveal(epochId: number): Promise<EpochData | undefined> {
    return Promise.resolve(this.lastEpochData);
  }

  async getResultAfterDeadline(
    epochId: number,
    deadlineSec: number
  ): Promise<string> {
    await this.index.awaitLaterBlock(deadlineSec);
    const result = await calculateResults(epochId);
    return result.merkleRoot.value;
  }
  // End SubProtocol implementation

  private registerPriceProviders(priceProviders: IPriceProvider[]) {
    for (const priceProvier of priceProviders) {
      this.priceProvidersByFeed.set(
        feedId(priceProvier.getFeedInfo()),
        priceProvier
      );
    }
  }

  /**
   * Placeholder for registering as a voter with a default constant weight.
   * To be replaced with a proper mechanism.
   */
  async registerAsVoter(rewardEpochId: number): Promise<void> {
    this.logger.info(
      `Registering as a voter for reward epoch ${rewardEpochId}`
    );
    try {
      await this.provider.registerAsVoter(rewardEpochId, DEFAULT_VOTER_WEIGHT);
    } catch (e) {
      const error = asError(e);
      if (error.message.includes("already registered")) {
        this.logger.info(
          `Already registered as a voter for reward epoch ${rewardEpochId}`
        );
      } else {
        throw error;
      }
    }
    this.logger.info(
      `Done registering as a voter for reward epoch ${rewardEpochId}`
    );
  }

  async commit(data: EpochData) {
    const hash = hashForCommit(
      this.address,
      data.random.value,
      data.merkleRoot,
      data.pricesHex
    );
    this.logger.info(
      `Committing to price epoch ${data.epochId} with hash ${hash}`
    );
    await this.provider.commit(hash);
  }

  async reveal(data: EpochData) {
    await this.provider.revealBitvote(data);
  }

  async signResult(priceEpochId: number, result: string): Promise<void> {
    const signature = await this.provider.signMessage(result);
    await this.provider.signResult(priceEpochId, result, {
      v: signature.v,
      r: signature.r,
      s: signature.s,
    });
  }

  async getPriceProviders(
    priceEpochId: number
  ): Promise<(IPriceProvider | undefined)[]> {
    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    return rewardEpochFeedSequence(
      await this.index.getRewardOffers(rewardEpoch)
    ).map((feed) => this.priceProvidersByFeed.get(feedId(feed)));
  }

  async getPricesForEpoch(priceEpochId: number): Promise<EpochData> {
    if (this.priceProvidersByFeed.size === 0)
      throw new Error("No price feeds registered.");

    const prices = (await this.getPriceProviders(priceEpochId)).map(
      (priceFeed) =>
        priceFeed
          ? priceFeed.getPriceForEpoch(priceEpochId)
          : NON_EXISTENT_PRICE
    );
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

  async publishPrices(prices: EpochResult, symbolIndices: number[]) {
    this.logger.info(
      `Publishing ${prices.medianData.length} prices for price epoch ${prices.priceEpochId}.`
    );
    return await this.provider.publishPrices(prices, symbolIndices);
  }
}
