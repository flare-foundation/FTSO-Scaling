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
  required_indexer_history_time_sec: number;
  indexer_top_timeout: number;

  // Price Provider url (PRICE_PROVIDER_URL)
  price_provider_url: string;
}

export default () => {
  // First go over env variables that are required
  if (process.env.PRICE_PROVIDER_BASE_URL == undefined) {
    throw Error("Must provide a private key in PRICE_PROVIDER_BASE_URL env variable.");
  }

  const api_keys = process.env.API_KEYS?.split(",") || [""];

  const config: IConfig = {
    port: parseInt(process.env.PORT || "3000"),
    api_keys,
    db_host: process.env.DB_HOST || "localhost",
    db_port: parseInt(process.env.DB_PORT!) || 3306,
    db_user: process.env.DB_USERNAME || "root",
    db_pass: process.env.DB_PASSWORD || "root",
    db_name: process.env.DB_NAME || "flare_top_level_indexer",
    price_provider_url: process.env.PRICE_PROVIDER_BASE_URL,
    required_indexer_history_time_sec: parseInt(process.env.DB_REQUIRED_INDEXER_HISTORY_TIME_SEC) || 14 * 24 * 60 * 60, // 14 days
    indexer_top_timeout: parseInt(process.env.INDEXER_TOP_TIMEOUT) || 5,
  };
  return config;
};
