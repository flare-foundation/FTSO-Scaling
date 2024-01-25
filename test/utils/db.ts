import { DataSource, EntityManager } from "typeorm";
import { TLPTransaction, TLPEvents, TLPState } from "../../libs/ftso-core/src/orm/entities";
import { FIRST_DATABASE_INDEX_STATE, LAST_DATABASE_INDEX_STATE } from "../../libs/ftso-core/src/configs/networks";
import { currentTimeSec, generateState } from "./generators";

const sqliteDatabase = `:memory:`;

export async function getDataSource(readOnly = false) {
  const dataSource = new DataSource({
    type: "sqlite",
    database: sqliteDatabase,
    entities: [TLPTransaction, TLPEvents, TLPState],
    synchronize: !readOnly,
    flags: readOnly ? 1 : undefined,
  });

  await dataSource.initialize();
  return dataSource;
}

export class MockIndexerDB {
  constructor(
    private readonly ds: DataSource,
    readonly em: EntityManager,
    private lowerState: TLPState,
    private upperState: TLPState
  ) {}

  async addEvent(items: TLPEvents[]) {
    await this.em.save(items);
    await this.updateTime(items);
  }

  async addTransaction(items: TLPTransaction[]) {
    await this.em.save(items);
    await this.updateTime(items);
  }

  private async updateTime(items: any[]) {
    const maxTimestamp = items.reduce((max, i: any) => Math.max(max, i.timestamp), 0);
    this.upperState.block_timestamp = maxTimestamp + 1;
    await this.em.save(this.upperState);
  }

  /** Increases the last seen block timestamp in the database. */
  async syncTimeToNow() {
    this.upperState.block_timestamp = currentTimeSec();
    await this.em.save(this.upperState);
  }

  async close() {
    this.ds.destroy();
  }
  static async create(startTimeSec: number = 0) {
    const ds = await getDataSource(false);
    const em = ds.createEntityManager();

    const lowerState = generateState(FIRST_DATABASE_INDEX_STATE, 0);
    const upperState = generateState(LAST_DATABASE_INDEX_STATE, 1);
    lowerState.block_timestamp = startTimeSec;
    upperState.block_timestamp = 0;

    await em.save([lowerState, upperState]);

    const db = new MockIndexerDB(ds, em, lowerState, upperState);
    return db;
  }
}
