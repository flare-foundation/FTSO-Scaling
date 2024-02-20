import { throwError } from "../../../../libs/ftso-core/src/utils/error";

export interface IConfig {
  // server port (PORT)
  port: number;
  api_keys: string[];

  // DB credentials
  db_host: string;
  db_port: number;
  db_user: string;
  db_pass: string;
  db_name: string;
  required_indexer_history_time_sec: number;
  voting_round_history_size: number;
  indexer_top_timeout: number;

  // Price Provider url (PRICE_PROVIDER_URL)
  price_provider_url: string;
}

export default () => {
  const config: IConfig = {
    port: parseInt(
      process.env.DATA_PROVIDER_CLIENT_PORT ?? throwError("DATA_PROVIDER_CLIENT_PORT env variable not set")
    ),
    api_keys: process.env.DATA_PROVIDER_CLIENT_API_KEYS?.split(",") || [],
    db_host: process.env.DB_HOST ?? throwError("DB_HOST env variable not set"),
    db_port: parseInt(process.env.DB_PORT ?? throwError("DB_PORT env variable not set")),
    db_user: process.env.DB_USERNAME ?? throwError("DB_USERNAME env variable not set"),
    db_pass: process.env.DB_PASSWORD ?? throwError("DB_PASSWORD env variable not set"),
    db_name: process.env.DB_NAME ?? throwError("DB_NAME env variable not set"),
    price_provider_url:
      process.env.PRICE_PROVIDER_BASE_URL ?? throwError("PRICE_PROVIDER_BASE_URL env variable not set"),
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
