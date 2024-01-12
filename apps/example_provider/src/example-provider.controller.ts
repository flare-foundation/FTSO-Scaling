import { Body, Controller, Get, Param, ParseIntPipe, Post, Inject } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PriceFeedResponse, PriceFeedsRequest, PriceFeedsResponse } from "./dto/provider-requests.dto";
import { ExampleProviderService } from "./example-provider-service";

@ApiTags("Price Provider API")
@Controller()
export class ExampleProviderController {
  constructor(@Inject("EXAMPLE_PROVIDER_SERVICE") private readonly priceProviderService: ExampleProviderService) {}

  @Post("preparePriceFeeds/:votingRoundId")
  async getPriceFeeds(
    @Param("votingRoundId", ParseIntPipe) votingRoundId: number,
    @Body() body: PriceFeedsRequest
  ): Promise<PriceFeedsResponse> {
    const prices = await this.priceProviderService.getPrices(body.feeds);
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
    return {
      votingRoundId,
      feedPriceData: prices,
    };
  }
}
