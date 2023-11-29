import { DataSource } from "typeorm";
import { FtsoTransaction, FtsoLog, State } from "./protocol/Entity";
import { retry } from "./utils/retry";

const database = `./db/indexer.db`;

export async function getDataSource(readOnly = false) {
  // TODO: Load params from config
  const dataSource = new DataSource({
    type: "sqlite",
    database: database,
    entities: [FtsoTransaction, FtsoLog, State],
    synchronize: !readOnly,
    flags: readOnly ? 1 : undefined,
  });
  await retry(async () => {
    await dataSource.initialize();
  });

  return dataSource;
}
