import { BlockIndex } from "./BlockIndex";
import { EpochSettings } from "./protocol/utils/EpochSettings";
import { IVotingProvider } from "./providers/IVotingProvider";
import { sleepFor } from "./utils/time";
import { errorString } from "./utils/error";
import { getLogger } from "./utils/logger";
import { retry } from "./utils/retry";

export class BlockIndexer extends BlockIndex {
  private logger = getLogger(BlockIndexer.name);
  private lastProcessedBlockNumber = 0;

  constructor(private readonly provider: IVotingProvider) {
    super(EpochSettings.fromProvider(provider), provider.contractAddresses);
  }

  async run(startBlock: number | undefined = undefined) {
    if (startBlock) {
      this.lastProcessedBlockNumber = startBlock - 1;
    } else {
      this.lastProcessedBlockNumber = (await this.provider.getBlockNumber()) - 1;
    }

    while (true) {
      await this.processNewBlocks();
      await sleepFor(500);
    }
  }

  async processNewBlocks() {
    // this.logger.info(`Processing new blocks from ${this.lastProcessedBlockNumber + 1}.`);
    try {
      const currentBlockNumber = await this.provider.getBlockNumber();
      while (this.lastProcessedBlockNumber < currentBlockNumber) {
        const block = await retry(
          async () => {
            return await this.provider.getBlock(this.lastProcessedBlockNumber + 1);
          },
          3,
          2000
        );
        await this.processBlock(block);
        this.lastProcessedBlockNumber++;
      }
    } catch (e: unknown) {
      this.logger.error(`Error processing new blocks ${this.lastProcessedBlockNumber}: ${errorString(e)}`);
      throw e;
    }
  }
}
