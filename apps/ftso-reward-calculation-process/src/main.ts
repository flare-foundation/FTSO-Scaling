import { CommandFactory } from "nest-commander";
import { FtsoRewardCalculationProcessModule } from "./ftso-reward-calculation-process.module";

async function bootstrap() {
  await CommandFactory.run(FtsoRewardCalculationProcessModule);
}
bootstrap();
