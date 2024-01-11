import { Test, TestingModule } from "@nestjs/testing";
import { ExampleProviderService } from "../src/example-provider-service";
import { ExampleProviderController } from "../src/example-provider.controller";

describe("ExampleProviderController", () => {
  let exampleProviderController: ExampleProviderController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [ExampleProviderController],
      providers: [ExampleProviderService],
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
