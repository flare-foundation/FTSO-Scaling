import e from "express";
import { EpochSettings } from "../../../../libs/ftso-core/src/utils/EpochSettings";
import { FTSOParameters, loadFTSOParameters } from "./FTSOParameters";
import fs from "fs";

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

  epochSettings: EpochSettings;
  params: FTSOParameters;

  // Price Provider url (PRICE_PROVIDER_URL)
  price_provider_url: string;

  // Testing only
  protocol_id?: number;
}

export default () => {
  // First go over env variables that are required
  if (process.env.PRICE_PROVIDER_BASE_URL == undefined) {
    throw Error("Must provide a private key in PRICE_PROVIDER_BASE_URL env variable.");
  }

  const api_keys = process.env.API_KEYS?.split(",") || [""];

  let epochSettings: EpochSettings;

  if (process.env.EPOCH_SETTINGS_FILE !== undefined) {
    const rw = JSON.parse(fs.readFileSync(process.env.EPOCH_SETTINGS_FILE, "utf8"));
    epochSettings = Object.assign(new EpochSettings(0, 0, 0, 0), rw);
    console.log(`Loaded epoch settings: ${JSON.stringify(epochSettings)}`);
  } else {
    epochSettings = new EpochSettings(
      parseInt(process.env.ES_FIRST_VOTING_ROUND_START_TS) || 1704250616,
      parseInt(process.env.ES_VOTING_EPOCH_DURATION_SECONDS) || 20,
      parseInt(process.env.ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID) || 1000,
      parseInt(process.env.ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS) || 5
      // TODO: Throw if any of these are undefined instead of defaulting to values
    );
  }

  const config: IConfig = {
    port: parseInt(process.env.PORT || "3000"),
    api_keys,
    db_host: process.env.DB_HOST || "localhost",
    db_port: parseInt(process.env.DB_PORT!) || 3306,
    db_user: process.env.DB_USERNAME || "root",
    db_pass: process.env.DB_PASSWORD || "root",
    db_name: process.env.DB_NAME || "flare_top_level_indexer",
    params: loadFTSOParameters(),
    epochSettings: epochSettings,
    price_provider_url: process.env.PRICE_PROVIDER_BASE_URL,
    protocol_id: parseInt(process.env.PROTOCOL_ID || "1"),
  };
  return config;
};
