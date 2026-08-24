import { NestFactory } from "@nestjs/core";
import * as workerPool from "workerpool";
import { FtsoRewardCalculationProcessModule } from "../ftso-reward-calculation-process.module";
import { OptionalCommandOptions } from "../interfaces/OptionalCommandOptions";
import { CalculatorService } from "../services/calculator.service";
import { runCalculateRewardClaimWorker } from "../libs/reward-claims-calculation";

async function run(options: OptionalCommandOptions) {
  // An application context: this worker never serves HTTP.
  const app = await NestFactory.createApplicationContext(FtsoRewardCalculationProcessModule);
  try {
    const calculator = app.get(CalculatorService);
    await runCalculateRewardClaimWorker(calculator.dataManager, options);
  } finally {
    await app.close();
  }
}

workerPool.worker({
  run: run,
});
