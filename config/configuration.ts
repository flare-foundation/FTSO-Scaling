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
}

export default () => {
  const api_keys = process.env.API_KEYS?.split(',') || [''];
  const config: IConfig = {
    port: parseInt(process.env.PORT || '3000'),
    api_keys,
    db_host: process.env.DB_HOST || 'localhost',
    db_port: parseInt(process.env.DB_PORT) || 3306,
    db_user: process.env.DB_USERNAME || 'root',
    db_pass: process.env.DB_PASSWORD || 'root',
    db_name: process.env.DB_NAME || 'flare_top_level_indexer',
  };
  return config;
};
