import { throwError } from "../../../../libs/ftso-core/src/utils/error";

export interface IConfig {
  // server port (PORT)
  port: number;
  // comma separated list of API keys (API_KEYS)
  api_keys: string[];
  // DB credentials
  db_host: string;
  db_port: number;
  db_user: string;
  db_pass: string;
  db_name: string;

  db_sqlite3_path?: string;

  required_indexer_history_time_sec: number;
  voting_round_history_size: number;
  indexer_top_timeout: number;
}

export default () => {
  const api_keys = process.env.API_KEYS?.split(",") || [""];
  const config: IConfig = {
    port: parseInt(process.env.PORT || "3000"),
    api_keys,
    db_host: process.env.DB_HOST || "localhost",
    db_port: parseInt(process.env.DB_PORT) || 3306,
    db_user: process.env.DB_USERNAME || "root",
    db_pass: process.env.DB_PASSWORD || "root",
    db_name: process.env.DB_NAME || "flare_top_level_indexer",
    db_sqlite3_path: process.env.DB_SQLITE3_PATH,
    required_indexer_history_time_sec: parseInt(
      process.env.DB_REQUIRED_INDEXER_HISTORY_TIME_SEC ??
        throwError("DB_REQUIRED_INDEXER_HISTORY_TIME_SEC env variable not set")
    ),
    voting_round_history_size: parseInt(
      process.env.VOTING_ROUND_HISTORY_SIZE ?? throwError("VOTING_ROUND_HISTORY_SIZE env variable not set")
    ),
    indexer_top_timeout: parseInt(
      process.env.INDEXER_TOP_TIMEOUT ?? throwError("INDEXER_TOP_TIMEOUT env variable not set")
    ),
  };
  return config;
};
