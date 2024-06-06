import { NestFactory } from "@nestjs/core";
import { FtsoRewardCalculationProcessModule } from "../ftso-reward-calculation-process.module";
import { CalculatorService } from "../services/calculator.service";
import { OptionalCommandOptions } from "../interfaces/OptionalCommandOptions";
import * as workerPool from "workerpool";
import { runCalculateRewardCalculationDataWorker } from "../libs/reward-data-calculation";

async function run(options: OptionalCommandOptions) {
  const app = await NestFactory.create(FtsoRewardCalculationProcessModule);
  const calculator = app.get(CalculatorService);
  await runCalculateRewardCalculationDataWorker(calculator.dataManager, options);
}

workerPool.worker({
  run: run,
});
