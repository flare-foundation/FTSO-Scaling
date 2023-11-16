import { BlockIndex } from "./protocol/BlockIndex";
import { IVotingProvider } from "./protocol/IVotingProvider";
import { EpochSettings } from "./protocol/utils/EpochSettings";
import { errorString, asError } from "./protocol/utils/error";
import { getLogger } from "./utils/logger";
import mysql, { RowDataPacket } from "mysql2/promise";
import { sleepFor } from "./utils/time";
import { TxData } from "./protocol/voting-types";
import { Log } from "web3-core";

/**
 * Since transaction timestamps are not unique, we also track the last seen id to avoid missing or processing transactions twice.
 * Simply using `WHERE timestamp > ? LIMIT 1000` doesn't work because we might get cut off in the middle of a transaction batch with the same timestamp,
 * and we wouldn't know where to continue from.
 */
const query =
  "SELECT id, hash, func_sig, data, timestamp, ftso_transactions.from, ftso_transactions.to FROM ftso_transactions WHERE timestamp >= ? AND id > ? ORDER BY id LIMIT 1000";
const QUERY_GET_LOG = "SELECT log FROM ftso_logs WHERE tx_hash = ?";

export class DBBlockIndexer extends BlockIndex {
  private readonly logger = getLogger(DBBlockIndexer.name);

  /** Function signatures for which we need to retrieve transaction logs (containing events). */
  private readonly logsNeeded = [
    this.encodingUtils.functionSignature("finalize"),
    this.encodingUtils.functionSignature("finalizeRewards"),
    this.encodingUtils.functionSignature("offerRewards"),
  ];

  private lastProcessedTimestamp: number | undefined;
  private lastSeenId = 0;

  // TODO: load DB config from ENV
  private readonly pool = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "root",
    database: "flare_ftso_indexer",
  });

  constructor(provider: IVotingProvider) {
    super(EpochSettings.fromProvider(provider), provider.contractAddresses);
  }

  // 0xf14fcbc8, 0x4369af80, 0x46f073cf, 0xcd79ae0a, 0x901d0e19, 0x40c40a01, 0x2636434d
  async run(startTimestamp: number | undefined = undefined) {
    this.logger.info(
      `Starting DB indexer, fun sigs: ${[
        this.encodingUtils.functionSignature("commit"),
        this.encodingUtils.functionSignature("revealBitvote"),
        this.encodingUtils.functionSignature("signResult"),
        this.encodingUtils.functionSignature("signRewards"),
        this.encodingUtils.functionSignature("finalize"),
        this.encodingUtils.functionSignature("finalizeRewards"),
        this.encodingUtils.functionSignature("offerRewards"),
      ].join(", ")}`
    );

    if (startTimestamp) {
      this.lastProcessedTimestamp = startTimestamp;
    } else {
      this.lastProcessedTimestamp = Math.floor(Date.now() / 1000);
    }

    while (true) {
      const txBatch = await this.pollTransactions();
      for (const tx of txBatch) {
        try {
          await this.processTx(tx[0], tx[1], true);
        } catch (e) {
          this.logger.error(`Error processing transaction ${tx[0].hash}: ${errorString(e)}`);
        }
      }

      if (txBatch.length === 0) {
        await sleepFor(1000);
      }
    }
  }

  async pollTransactions(): Promise<[TxData, number][]> {
    try {
      const [rows] = await this.pool.query<RowDataPacket[]>(query, [this.lastProcessedTimestamp, this.lastSeenId]);
      const txns = new Array<[TxData, number]>();
      for (const row of rows) {
        let logs: Log[] | undefined;
        if (this.logsNeeded.includes("0x" + row["func_sig"])) {
          logs = await this.getTxLog(row);
        }
        const txData: TxData = {
          hash: row["hash"],
          input: "0x" + row["data"],
          from: "0x" + row["from"],
          to: "0x" + row["to"],
          blockNumber: row["block_id"],
          logs: logs,
        };
        this.lastSeenId = row["id"];
        this.lastProcessedTimestamp = row["timestamp"];

        txns.push([txData, row["timestamp"]]);
      }
      return txns;
    } catch (e) {
      throw new Error("Database polling error:", { cause: asError(e) });
    }
  }

  private async getTxLog(row: mysql.RowDataPacket) {
    const [logRes] = await this.pool.query<RowDataPacket[]>(QUERY_GET_LOG, [row["hash"]]);
    return JSON.parse(logRes[0]["log"]);
  }
}
