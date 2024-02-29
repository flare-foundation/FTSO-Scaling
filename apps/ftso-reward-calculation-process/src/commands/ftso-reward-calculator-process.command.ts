import { Command, CommandRunner, Option } from "nest-commander";
import Web3 from "web3";
import { CONTRACTS } from "../../../../libs/ftso-core/src/configs/networks";
import { ABICache } from "../../../../libs/ftso-core/src/utils/ABICache";
import { CalculatorService, OptionalCommandOptions } from "../services/calculator.service";
@Command({
  name: "ftso-reward-calculation-process",
  options: {},
})
export class FtsoRewardCalculationProcessCommand extends CommandRunner {
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
      if (options.rewardEpochId === undefined && options.rpcUrl !== undefined) {
        const web3 = new Web3(options.rpcUrl);
        const abiCache = new ABICache();
        const abi = abiCache.contractNameToAbi.get("FlareSystemsManager");
        const flareSystemsManager = new web3.eth.Contract(abi, CONTRACTS.FlareSystemsManager.address);
        const rewardEpochId = await flareSystemsManager.methods.getCurrentRewardEpochId().call();
        options.rewardEpochId = parseInt(rewardEpochId as any) - 1;
      }
      await this.calculator.run(options);
    } catch (e) {
      console.log(e);
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
    flags: "-u, --rpcUrl [string]",
    description: "RPC url for network to get current reward epoch if reward epoch id is not provided",
  })
  parseRpcUrl(val: string): string {
    return val;
  }
}
