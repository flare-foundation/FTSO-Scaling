import { Test, TestingModule } from "@nestjs/testing";
import { FtsoCalculatorController } from "./ftso-calculator.controller";
import { FtsoCalculatorService } from "./ftso-calculator.service";

describe("FtsoCalculatorController", () => {
  let ftsoCalculatorController: FtsoCalculatorController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [FtsoCalculatorController],
      providers: [FtsoCalculatorService],
    }).compile();

    ftsoCalculatorController = app.get<FtsoCalculatorController>(FtsoCalculatorController);
  });

  describe("root", () => {
    it('should return "Hello World!"', () => {});
  });
});
