import { Body, Controller, Get, Param, ParseIntPipe, Post, Inject, Logger } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PriceFeedResponse, PriceFeedsRequest, PriceFeedsResponse } from "./dto/provider-requests.dto";
import { ExampleProviderService } from "./example-provider-service";
import { fromHex } from "./price-feeds/ccxt-provider-service";

@ApiTags("Price Provider API")
@Controller()
export class ExampleProviderController {
  private logger = new Logger(ExampleProviderController.name);
  constructor(@Inject("EXAMPLE_PROVIDER_SERVICE") private readonly priceProviderService: ExampleProviderService) {}

  @Post("preparePriceFeeds/:votingRoundId")
  async getPriceFeeds(
    @Param("votingRoundId", ParseIntPipe) votingRoundId: number,
    @Body() body: PriceFeedsRequest
  ): Promise<PriceFeedsResponse> {
    const prices = await this.priceProviderService.getPrices(body.feeds);
    this.logger.log(
      `Prices for voting round ${votingRoundId}: ${JSON.stringify(prices)}, feeds: ${body.feeds.map(f => fromHex(f))}`
    );
    return {
      votingRoundId,
      feedPriceData: prices,
    };
  }

  @Get("preparePriceFeed/:votingRoundId/:feed")
  async getPriceFeed(
    @Param("votingRoundId", ParseIntPipe) votingRoundId: number,
    @Param("feed") feed: string
  ): Promise<PriceFeedResponse> {
    const prices = await this.priceProviderService.getPrice(feed);
    this.logger.log(`Price for voting round ${votingRoundId}: ${JSON.stringify(prices)}, feed: ${fromHex(feed)}`);

    return {
      votingRoundId,
      feedPriceData: prices,
    };
  }
}
