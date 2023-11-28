import { getLogger } from "./utils/logger";
import { retry } from "./utils/retry";
import { sleepFor } from "./utils/time";
import { errorString } from "./protocol/utils/error";
import { BlockData, TxData } from "./protocol/voting-types";
import { FtsoTransaction, FtsoLog, State } from "./protocol/Entity";
import { getDataSource } from "./DataSource";
import { DataSource } from "typeorm";
import { ContractAddresses } from "./protocol/utils/ContractAddresses";
import { getFilteredBlock } from "./utils/web3";
import Web3 from "web3";

export class MockDBIndexer {
  private logger = getLogger(MockDBIndexer.name);
  private lastProcessedBlockNumber = 0;
  private dataSource!: DataSource;

  constructor(private readonly web3: Web3, private readonly contractAddresses: ContractAddresses) {}

  async run(startBlock: number | undefined = undefined) {
    this.dataSource = await getDataSource();

    if (startBlock) {
      this.lastProcessedBlockNumber = startBlock - 1;
    } else {
      this.lastProcessedBlockNumber = (await this.web3.eth.getBlockNumber()) - 1;
    }

    const state = new State();
    state.id = 0;
    state.name = "last_processed_block_timestamp";
    state.index = this.lastProcessedBlockNumber;
    state.updated = new Date();

    while (true) {
      await this.processNewBlocks(state);
      await sleepFor(500);
    }
  }

  async processNewBlocks(state: State) {
    try {
      const currentBlockNumber = await this.web3.eth.getBlockNumber();
      while (this.lastProcessedBlockNumber < currentBlockNumber) {
        const block = await retry(
          async () => {
            return await getFilteredBlock(this.web3, this.lastProcessedBlockNumber + 1, [
              this.contractAddresses.voting,
              this.contractAddresses.votingRewardManager,
            ]);
          },
          3,
          3000
        );
        await this.processBlock(block);
        state.index = block.timestamp;
        await this.dataSource.getRepository(State).save(state);
        this.lastProcessedBlockNumber++;
      }
    } catch (e: unknown) {
      this.logger.error(`Error processing new blocks ${this.lastProcessedBlockNumber}: ${errorString(e)}`);
      throw e;
    }
  }

  async processBlock(block: BlockData) {
    for (const tx of block.transactions) {
      await this.processTx(tx, block.timestamp);
    }
  }
  async processTx(tx: TxData, timestamp: number) {
    try {
      const ftx = new FtsoTransaction();
      ftx.hash = tx.hash.slice(2);
      ftx.func_sig = tx.input.slice(2, 10);
      ftx.data = tx.input.slice(2);
      ftx.block_id = tx.blockNumber;
      ftx.status = tx.status;
      ftx.from = tx.from.slice(2);
      ftx.to = tx.to?.slice(2) ?? "";
      ftx.timestamp = timestamp;

      await this.dataSource.getRepository(FtsoTransaction).save(ftx);

      getLogger("MockDBIndexer").info(
        `Added tx ${tx.hash} to db for sig ${tx.input.slice(2, 10)} with timestamp ${timestamp}`
      );
      if (tx.logs) {
        const logs = new FtsoLog();
        logs.tx_hash = tx.hash.slice(2);
        logs.log = JSON.stringify(tx.logs);
        logs.timestamp = timestamp;

        await this.dataSource.getRepository(FtsoLog).save(logs);
      }
    } catch (e) {
      this.logger.error(`Error adding tx ${tx.hash} to db: ${errorString(e)}`);
    }
  }
}
