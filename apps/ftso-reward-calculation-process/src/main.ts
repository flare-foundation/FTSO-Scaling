import { CommandFactory } from "nest-commander";
import { FtsoRewardCalculationProcessModule } from "./ftso-reward-calculation-process.module";
import { LogLevel } from "@nestjs/common";

async function bootstrap() {
  let logLevels: LogLevel[] = ["log"];
  if (process.env.LOG_LEVEL == "debug") {
    logLevels = ["verbose"];
  }

  await CommandFactory.run(FtsoRewardCalculationProcessModule, { logger: logLevels });
}
bootstrap();
