
import { BlockIndex } from "./protocol/BlockIndex";
import { IVotingProvider } from "./protocol/IVotingProvider";
import { EpochSettings } from "./protocol/utils/EpochSettings";
import { errorString, asError } from "./protocol/utils/error";
import { getLogger } from "./utils/logger";
import mysql, { RowDataPacket } from "mysql2/promise";
import { sleepFor } from "./utils/time";

/**
 * Since transaction timestamps are not unique, we also track the last seen id to avoid missing or processing transactions twice.
 * Simply using `WHERE timestamp > ? LIMIT 1000` doesn't work because we might get cut off in the middle of a transaction batch with the same timestamp,
 * and we wouldn't know where to continue from.
 */
const query = "SELECT id, method, data, timestamp FROM ftso_transactions WHERE timestamp >= ? AND id > ? ORDER BY id LIMIT 1000";
// TODO: filter by to field for contract addresses.

interface TxResult {
  id: number;
  method: string;
  data: string;
  timestamp: number;
}

export class BlockIndexer extends BlockIndex {
  private logger = getLogger(BlockIndexer.name);
  private lastProcessedTimestamp: number | undefined;

  constructor(private readonly provider: IVotingProvider) {
    super(EpochSettings.fromProvider(provider), provider.contractAddresses);
  }

  private readonly pool = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "root",
    database: "flare_ftso_indexer",
  });

  async run(startTimestamp: number | undefined = undefined) {
    if (startTimestamp) {
      this.lastProcessedTimestamp = startTimestamp;
    } else {
      this.lastProcessedTimestamp = Date.now() / 1000;
    }

    while (true) {
      const txBatch = await this.pollTransactions();
      for (const tx of txBatch) {
        try {
          await this.processTx(tx, tx.timestamp);
        } catch (e) {
          this.logger.error(`Error processing transaction ${tx.id}: ${errorString(e)}`);
        }
      }

      if (txBatch.length === 0) {
        await sleepFor(1000);
      }
    }
  }

  private lastSeenId = 0;

  async pollTransactions(): Promise<TxResult[]> {
    try {
      const [rows] = await this.pool.query<RowDataPacket[]>(query, [this.lastProcessedTimestamp, this.lastSeenId]);

      rows.forEach(row => {
        const res = row as TxResult;
        console.log(`Got tx at ${res.timestamp} for ${res.method}, data: ${res.data.slice(0, 10)}`);
        this.lastSeenId = res.id;
        this.lastProcessedTimestamp = res.timestamp;
      });
      return rows as TxResult[];
    } catch (e) {
      throw new Error("Database polling error:", { cause: asError(e) });
    }
  }
}
