import { DataSource } from "typeorm";
import { TLPTransaction, TLPEvents, TLPState } from "../../libs/ftso-core/src/orm/entities";

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
