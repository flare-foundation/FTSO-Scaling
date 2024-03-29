import { Command, CommandRunner, Option } from "nest-commander";
import { CalculatorService, OptionalCommandOptions } from "../services/calculator.service";
import { Logger } from "@nestjs/common";
@Command({
  name: "ftso-reward-calculation-process",
  options: { isDefault: true },
})
export class FtsoRewardCalculationProcessCommand extends CommandRunner {
  private logger = new Logger(FtsoRewardCalculationProcessCommand.name);
  constructor(private calculator: CalculatorService) {
    super();
  }

  /**
   * Returns a list of all (merged) reward claims for the given reward epoch.
   * Calculation can be quite intensive.
   * @param rewardEpochId
   * @returns
   */
  async run(inputs: string[], options: OptionalCommandOptions): Promise<void> {
    try {
      await this.calculator.run(options);
    } catch (e) {
      this.logger.error(e);
    }
  }

  @Option({
    flags: "-r, --rewardEpochId [number]",
    description: "Reward epoch id",
  })
  parseRewardEpochId(val: string): number {
    return Number(val);
  }

  @Option({
    flags: "-d, --startRewardEpochId [number]",
    description: "Start reward epoch id",
  })
  parseStartRewardEpochId(val: string): number {
    return Number(val);
  }

  @Option({
    flags: "-n, --endRewardEpochId [number]",
    description:
      "End reward epoch id. If provided the limited range [startRewardEpochId, endRewardEpochId] will be used for reward epoch calculation. If only startEpochId is provided, incremental calculation for current reward epoch is assumed.",
  })
  parseEndRewardEpochId(val: string): number {
    return Number(val);
  }

  @Option({
    flags: "-x, --useExpectedEndIfNoSigningPolicyAfter [boolean]",
    description: "Use expected reward epoch end if no signing policy after",
  })
  parseUseExpectedEndIfNoSigningPolicyAfter(val: string): boolean {
    return JSON.parse(val);
  }

  @Option({
    flags: "-s, --startVotingRoundId [number]",
    description: "Start voting round id",
  })
  parseStartVotingRoundId(val: string): number {
    return Number(val);
  }

  @Option({
    flags: "-e, --endVotingRoundId [number]",
    description: "End voting round id",
  })
  parseEndVotingRoundId(val: string): number {
    return Number(val);
  }

  @Option({
    flags: "-i, --initialize [boolean]",
    description: "Initialize reward epoch calculation",
  })
  parseInitializeRewardEpochCalculation(val: string): boolean {
    return JSON.parse(val);
  }

  @Option({
    flags: "-c, --calculateClaims [boolean]",
    description: "Calculates reward claims",
  })
  parseCalculateClaims(val: string): boolean {
    return JSON.parse(val);
  }

  @Option({
    flags: "-a, --aggregateClaims [boolean]",
    description: "Initialize reward epoch calculation",
  })
  parseAggregateClaims(val: string): boolean {
    return JSON.parse(val);
  }

  @Option({
    flags: "-o, --recoveryMode [boolean]",
    description: "Calculates in recovery mode (using the last known state)",
  })
  parseRecoveryMode(val: string): boolean {
    return JSON.parse(val);
  }

  @Option({
    flags: "-b, --batchSize [number]",
    description: "Batch size for multithreaded reward claims calculation",
  })
  parseBatchSize(val: string): number {
    return Number(val);
  }

  @Option({
    flags: "-w, --numberOfWorkers [number]",
    description: "Number of workers for multithreaded reward claims calculation",
  })
  parseNumberOfWorkers(val: string): number {
    return Number(val);
  }

  @Option({
    flags: "-m, --retryDelayMs [number]",
    description: "Retry delay in ms for incremental reward claims calculation",
    defaultValue: "10000",
  })
  parseRetryDelayMs(val: string): number {
    return Number(val);
  }
}
