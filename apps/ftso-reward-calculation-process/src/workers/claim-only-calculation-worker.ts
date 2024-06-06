import { NestFactory } from "@nestjs/core";
import * as workerPool from "workerpool";
import { FtsoRewardCalculationProcessModule } from "../ftso-reward-calculation-process.module";
import { OptionalCommandOptions } from "../interfaces/OptionalCommandOptions";
import { CalculatorService } from "../services/calculator.service";
import { runCalculateRewardClaimWorker } from "../libs/reward-claims-calculation";

async function run(options: OptionalCommandOptions) {
  const app = await NestFactory.create(FtsoRewardCalculationProcessModule);
  const calculator = app.get(CalculatorService);
  await runCalculateRewardClaimWorker(calculator.dataManager, options);
}

workerPool.worker({
  run: run,
});
