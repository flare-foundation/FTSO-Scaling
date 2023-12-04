import { IVotingProvider } from "../../libs/ftso-core/src/IVotingProvider";
import { IndexerClient } from "../../libs/ftso-core/src/IndexerClient";
import { EpochSettings } from "../../libs/ftso-core/src/utils/EpochSettings";
import { errorString } from "../../libs/ftso-core/src/utils/error";
import { getLogger } from "../../apps/ftso-calculator/src/utils/logger";
import { retry } from "../../apps/ftso-calculator/src/utils/retry";
import { sleepFor } from "../../apps/ftso-calculator/src/utils/time";


export class BlockIndexer extends IndexerClient {
  private logger = getLogger(BlockIndexer.name);
  private lastProcessedBlockNumber = 0;

  constructor(private readonly myId: number, private readonly provider: IVotingProvider) {
    super(myId, EpochSettings.fromProvider(provider), provider.contractAddresses);
  }

  async run(startBlock: number | undefined = undefined) {
    await this.initialize();
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
    try {
      const currentBlockNumber = await this.provider.getBlockNumber();
      while (this.lastProcessedBlockNumber < currentBlockNumber) {
        const block = await retry(
          async () => {
            return await this.provider.getBlock(this.lastProcessedBlockNumber + 1);
          },
          3,
          3000
        );
        await this.processBlock(block);
        this.blockProcessed(block.timestamp);
        this.lastProcessedBlockNumber++;
      }
    } catch (e: unknown) {
      this.logger.error(`Error processing new blocks ${this.lastProcessedBlockNumber}: ${errorString(e)}`);
      throw e;
    }
  }
}
