import { NestFactory } from "@nestjs/core";
import { FtsoRewardCalculationProcessModule } from "./ftso-reward-calculation-process.module";
import { CalculatorService, OptionalCommandOptions } from "./services/calculator.service";
import * as workerPool from "workerpool";

async function run(options: OptionalCommandOptions) {
  const app = await NestFactory.create(FtsoRewardCalculationProcessModule);
  const calculator = app.get(CalculatorService);
  await calculator.run(options);
}

workerPool.worker({
  run: run,
});
