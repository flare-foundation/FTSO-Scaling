import { Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { prepareResultsForVotingRound } from "../../../../libs/ftso-core/src/ftso-calculation/ftso-calculation-logic";
import { bigIntReplacer, bigIntReviver } from "../../../../libs/ftso-core/src/utils/big-number-serialization";
import { errorString } from "../../../../libs/ftso-core/src/utils/error";
import {
  EpochResult,
  MedianCalculationResult,
  RandomCalculationResult,
} from "../../../../libs/ftso-core/src/voting-types";

/** On-disk shape of a cached round: the calculation data the merkle tree is rebuilt from. */
interface StoredEpochResult {
  votingRoundId: number;
  medianData: MedianCalculationResult[];
  randomData: RandomCalculationResult;
}

/**
 * Disk-backed cache of finalized EpochResults so they survive process
 * restarts, one JSON file per voting round (`<dir>/<votingRoundId>.json`).
 *
 * Only the calculation data (medianData, randomData) is persisted; the merkle
 * tree is rebuilt deterministically from it on load, so no class instances
 * are serialized. Entries are written atomically (temp file + rename) and a
 * file that fails to load is deleted so the round falls back to recompute.
 *
 * Eviction is by round age: when the file count exceeds maxRounds, the lowest
 * votingRoundIds are deleted.
 */
export class EpochResultDiskCache {
  /** Round ids present on disk, mirrored in memory to avoid readdir on every access. */
  private readonly roundIds = new Set<number>();

  constructor(
    private readonly dir: string,
    private readonly maxRounds: number,
    private readonly logger: Logger
  ) {}

  /** Creates the cache directory and indexes (and trims) existing entries. Throws if the directory is unusable. */
  init(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    for (const name of fs.readdirSync(this.dir)) {
      const match = /^(\d+)\.json$/.exec(name);
      if (match) {
        this.roundIds.add(parseInt(match[1]));
      }
    }
    for (const id of this.excessRoundIds()) {
      this.roundIds.delete(id);
      try {
        fs.unlinkSync(this.filePath(id));
      } catch (e) {
        this.logger.warn(`Failed to evict cached result for round ${id}: ${errorString(e)}`);
      }
    }
    this.logger.log(`Epoch result disk cache at ${this.dir}: ${this.roundIds.size}/${this.maxRounds} rounds`);
  }

  async get(votingRoundId: number): Promise<EpochResult | undefined> {
    if (!this.roundIds.has(votingRoundId)) {
      return undefined;
    }
    try {
      const raw = await fs.promises.readFile(this.filePath(votingRoundId), "utf8");
      const stored = JSON.parse(raw, bigIntReviver) as Partial<StoredEpochResult> | null;
      if (
        stored == null ||
        stored.votingRoundId !== votingRoundId ||
        !Array.isArray(stored.medianData) ||
        stored.randomData == null
      ) {
        throw new Error("Malformed cache entry");
      }
      return prepareResultsForVotingRound(stored.votingRoundId, stored.medianData, stored.randomData);
    } catch (e) {
      this.logger.warn(`Discarding unreadable cached result for round ${votingRoundId}: ${errorString(e)}`);
      this.roundIds.delete(votingRoundId);
      await fs.promises.unlink(this.filePath(votingRoundId)).catch(() => undefined);
      return undefined;
    }
  }

  /** Persists a result and evicts the oldest rounds if over capacity. Never throws — a failed write only costs a future recompute. */
  async set(result: EpochResult): Promise<void> {
    const file = this.filePath(result.votingRoundId);
    const tmp = file + ".tmp";
    try {
      const json = JSON.stringify(
        { votingRoundId: result.votingRoundId, medianData: result.medianData, randomData: result.randomData },
        bigIntReplacer
      );
      await fs.promises.writeFile(tmp, json);
      await fs.promises.rename(tmp, file);
      this.roundIds.add(result.votingRoundId);
    } catch (e) {
      this.logger.warn(`Failed to write cached result for round ${result.votingRoundId}: ${errorString(e)}`);
      return;
    }
    for (const id of this.excessRoundIds()) {
      this.roundIds.delete(id);
      await fs.promises.unlink(this.filePath(id)).catch((e) => {
        this.logger.warn(`Failed to evict cached result for round ${id}: ${errorString(e)}`);
      });
    }
  }

  private excessRoundIds(): number[] {
    if (this.roundIds.size <= this.maxRounds) {
      return [];
    }
    return [...this.roundIds].sort((a, b) => a - b).slice(0, this.roundIds.size - this.maxRounds);
  }

  private filePath(votingRoundId: number): string {
    return path.join(this.dir, `${votingRoundId}.json`);
  }
}
