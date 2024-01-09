import { Test, TestingModule } from "@nestjs/testing";
import { ExampleProviderController } from "../src/example-provider.controller";
import { RandomProviderService } from "../src/services/random-provider-service";

describe("ExampleProviderController", () => {
  let exampleProviderController: ExampleProviderController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [ExampleProviderController],
      providers: [RandomProviderService],
    }).compile();

    exampleProviderController = app.get<ExampleProviderController>(ExampleProviderController);
  });

  describe("Example Random provider test ", () => {
    it('return the voting round id that was provided"', async () => {
      const feedRes = await exampleProviderController.getPriceFeed(123, "BTC-USD");
      expect(feedRes.votingRoundId).toBe(123);
    });
  });
});
