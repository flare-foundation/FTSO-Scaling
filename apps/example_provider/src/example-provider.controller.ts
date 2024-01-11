import { Body, Controller, Get, Param, ParseIntPipe, Post, Inject } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PriceFeedResponse, PriceFeedsRequest, PriceFeedsResponse } from "./dto/provider-requests.dto";
import { ExampleProviderService } from "./example-provider-service";

@ApiTags("Example Provider APIS")
@Controller()
export class ExampleProviderController {
  constructor(@Inject("EXAMPLE_PROVIDER_SERVICE") private readonly priceProviderService: ExampleProviderService) {}

  @Post("preparePriceFeeds/:votingRoundId")
  async getPriceFeeds(
    @Param("votingRoundId", ParseIntPipe) votingRoundId: number,
    @Body() body: PriceFeedsRequest
  ): Promise<PriceFeedsResponse> {
    const prices = await this.priceProviderService.getPrices(body.priceFeeds);
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
    const split_feed = feed.split("-");
    if (split_feed.length !== 2) {
      throw new Error("Invalid feed, feed should be formatted as <offerSymbol>-<quoteSymbol> for example (BTC-USD)");
    }
    const Feed = {
      offerSymbol: split_feed[0],
      quoteSymbol: split_feed[1],
    };

    const prices = await this.priceProviderService.getPrice(Feed);
    return {
      votingRoundId,
      feedPriceData: prices,
    };
  }
}
