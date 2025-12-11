import { RewardEpochStarted } from "../../contracts/src/events";
import { EpochSettings } from "./utils/EpochSettings";
import { networks } from "../../contracts/src/constants";

// State names in indexer database
export const LAST_CHAIN_INDEX_STATE = "last_chain_block";
export const LAST_DATABASE_INDEX_STATE = "last_database_block";
export const FIRST_DATABASE_INDEX_STATE = "first_database_block";

const ftso2ProtocolId = () => {
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "coston":
    case "from-env":
    case "local-test":
    case "coston2":
    case "songbird":
    case "flare":
      return 100;
    default:
      // Ensure exhaustive checking
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => {})(network);
  }
};

// Protocol id for FTSO2
export const FTSO2_PROTOCOL_ID = ftso2ProtocolId();

const epochSettings = () => {
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "from-env":
      return new EpochSettings(
        Number(process.env.ES_FIRST_VOTING_ROUND_START_TS),
        Number(process.env.ES_VOTING_EPOCH_DURATION_SECONDS),
        Number(process.env.ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID),
        Number(process.env.ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS),
        Number(process.env.FTSO_REVEAL_DEADLINE_SECONDS)
      );
    case "coston":
      return new EpochSettings(
        1658429955, // ES_FIRST_VOTING_ROUND_START_TS
        90, //ES_VOTING_EPOCH_DURATION_SECONDS
        0, //ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID
        240, //ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS
        45 //FTSO_REVEAL_DEADLINE_SECONDS
      );
    case "coston2":
      return new EpochSettings(
        1658430000, // ES_FIRST_VOTING_ROUND_START_TS
        90, //ES_VOTING_EPOCH_DURATION_SECONDS
        0, //ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID
        240, //ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS
        45 //FTSO_REVEAL_DEADLINE_SECONDS
      );
    case "songbird":
      return new EpochSettings(
        1658429955, // ES_FIRST_VOTING_ROUND_START_TS
        90, //ES_VOTING_EPOCH_DURATION_SECONDS
        0, //ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID
        3360, //ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS
        45 //FTSO_REVEAL_DEADLINE_SECONDS
      );
    case "flare":
      return new EpochSettings(
        1658430000, // ES_FIRST_VOTING_ROUND_START_TS
        90, //ES_VOTING_EPOCH_DURATION_SECONDS
        0, //ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID
        3360, //ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS
        45 //FTSO_REVEAL_DEADLINE_SECONDS
      );
    case "local-test":
      return new EpochSettings(
        1707110090, // ES_FIRST_VOTING_ROUND_START_TS
        20, //ES_VOTING_EPOCH_DURATION_SECONDS
        1000, //ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID
        5, //ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS
        10 //FTSO_REVEAL_DEADLINE_SECONDS
      );
    default:
      // Ensure exhaustive checking
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => {})(network);
  }
};

const constantEpochSettings = epochSettings();

export const EPOCH_SETTINGS = () => {
  const network = process.env.NETWORK as networks;
  if (network === "from-env") {
    return epochSettings();
  }
  return constantEpochSettings;
};

const randomGenerationBenchingWindow = () => {
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "from-env": {
      if (!process.env.RANDOM_GENERATION_BENCHING_WINDOW) {
        throw new Error("RANDOM_GENERATION_BENCHING_WINDOW value is not provided");
      }
      try {
        const num = parseInt(process.env.RANDOM_GENERATION_BENCHING_WINDOW);
        if (num >= 0) {
          return num;
        }
        throw new Error("RANDOM_GENERATION_BENCHING_WINDOW must be a non negative integer");
      } catch {
        throw new Error("RANDOM_GENERATION_BENCHING_WINDOW must be an integer");
      }
    }
    case "local-test":
      return 20;
    case "coston":
      return 20;
    case "coston2":
      return 20;
    case "songbird":
      return 20;
    case "flare":
      return 20;
    default:
      // Ensure exhaustive checking
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => {})(network);
  }
};

const constantRandomGenerationBenchingWindow = randomGenerationBenchingWindow();

export const RANDOM_GENERATION_BENCHING_WINDOW = () => {
  if (process.env.NETWORK === "from-env") {
    return randomGenerationBenchingWindow();
  }
  return constantRandomGenerationBenchingWindow;
};

const initialRewardEpochId = () => {
  const network = process.env.NETWORK as networks;
  switch (network) {
    case "from-env": {
      if (!process.env.INITIAL_REWARD_EPOCH_ID) {
        throw new Error("INITIAL_REWARD_EPOCH_ID value is not provided");
      }
      return parseInt(process.env.INITIAL_REWARD_EPOCH_ID);
    }
    case "coston":
      return 2466;
    case "coston2":
      return 3110;
    case "songbird":
      return 183;
    case "flare":
      return 223;
    case "local-test":
      return 0;
    default:
      // Ensure exhaustive checking
      // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
      ((_: never): void => {})(network);
  }
};

export const INITIAL_REWARD_EPOCH_ID = initialRewardEpochId();

export const GENESIS_REWARD_EPOCH_START_EVENT = () => {
  const result: RewardEpochStarted = {
    rewardEpochId: INITIAL_REWARD_EPOCH_ID,
    timestamp: EPOCH_SETTINGS().expectedRewardEpochStartTimeSec(INITIAL_REWARD_EPOCH_ID),
    startVotingRoundId: EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(INITIAL_REWARD_EPOCH_ID),
  };
  return result;
};
