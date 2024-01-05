import { EpochSettings } from "../../../../libs/ftso-core/src/utils/EpochSettings";
import { FTSOParameters, loadFTSOParameters } from "./FTSOParameters";

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
  privateKey: string;
}

export default () => {
  const api_keys = process.env.API_KEYS?.split(",") || [""];
  // const epochs = process.env.EPOCH_SETTINGS.split(",").map(x => parseInt(x, 10));

  // rewardEpochStartSec: 1704213286,
  // rewardEpochDurationSec: 100,
  // firstVotingEpochStartSec: 1704193286,
  // votingEpochDurationSec: 20,

  // const epochSettings = new EpochSettings(
  //   epochs[2],
  //   epochs[3],
  //   Math.floor((epochs[0] - epochs[2]) / epochs[3]),
  //   epochs[1] / epochs[3]
  // );

  const epochSettings = new EpochSettings(
    parseInt(process.env.ES_FIRST_VOTING_ROUND_START_TS) || 1704250616,
    parseInt(process.env.ES_VOTING_EPOCH_DURATION_SECONDS) || 20,
    parseInt(process.env.ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID) || 1000,
    parseInt(process.env.ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS) || 5
  );

  if (process.env.PRIVATE_KEY == undefined) {
    throw Error("Must provide a private key in PRIVATE_KEY env variable.");
  }

  const config: IConfig = {
    port: parseInt(process.env.PORT || "3000"),
    api_keys,
    db_host: process.env.DB_HOST || "localhost",
    db_port: parseInt(process.env.DB_PORT) || 3306,
    db_user: process.env.DB_USERNAME || "root",
    db_pass: process.env.DB_PASSWORD || "root",
    db_name: process.env.DB_NAME || "flare_top_level_indexer",
    params: loadFTSOParameters(),
    privateKey: process.env.PRIVATE_KEY,
    epochSettings: epochSettings,
  };
  return config;
};
