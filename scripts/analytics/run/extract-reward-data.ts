import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path/posix";
import { CALCULATIONS_FOLDER } from "../../../libs/fsp-rewards/src/constants";
import { IRewardClaimWithProof } from "../../../libs/fsp-rewards/src/utils/RewardClaim";
import {
  MINIMAL_CONDITIONS_FILE,
  PASSES_FILE,
  REWARD_DISTRIBUTION_DATA_FILE,
  REWARD_DISTRIBUTION_DATA_TUPLES_FILE,
  REWARD_DISTRIBUTION_MIN_CONDITIONS_DATA_FILE,
  REWARD_EPOCH_INFO_FILE
} from "../../../libs/fsp-rewards/src/utils/stat-info/constants";
import { bigIntReviver } from "../../../libs/ftso-core/src/utils/big-number-serialization";

const REWARDS_FOLDER = "rewards-data";

export function bigIntReplacerNoN(key: string, value: any): any {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}

export function tuplifyClaim(claim: IRewardClaimWithProof) {
  return [claim.merkleProof, [claim.body.rewardEpochId, claim.body.beneficiary, claim.body.amount, claim.body.claimType]];
}

async function main() {
  if (!process.argv[2]) {
    throw new Error("no network");
  }
  const network = process.argv[2];
  if (network !== "coston" && network !== "coston2" && network !== "songbird" && network !== "flare") {
    throw new Error(`invalid network: ${network}`);
  }

  if (!process.argv[3]) {
    throw new Error("no rewardEpochId");
  }
  const rewardEpochId = parseInt(process.argv[3]);

  let useMinimalConditions = true;
  // If the third argument is present, old way not considering minimal conditions is used
  // This is temporary solution which will not be used anymore in future and will be disabled.
  if (process.argv[4]) {
    useMinimalConditions = false;
  }
  if (!existsSync(REWARDS_FOLDER)) {
    mkdirSync(REWARDS_FOLDER);
  }
  const networkFolder = path.join(REWARDS_FOLDER, `${network}`);
  if (!existsSync(networkFolder)) {
    mkdirSync(networkFolder);
  }

  const rewardEpochFolder = path.join(networkFolder, `${rewardEpochId}`);
  if (!existsSync(rewardEpochFolder)) {
    mkdirSync(rewardEpochFolder);
  }

  process.env.NETWORK = network;
  const sourceFolder = path.join(CALCULATIONS_FOLDER(), `${rewardEpochId}`);

  // reward distribution file
  const inputFileName = useMinimalConditions ? REWARD_DISTRIBUTION_MIN_CONDITIONS_DATA_FILE : REWARD_DISTRIBUTION_DATA_FILE;

  if(!useMinimalConditions) {
    console.log("-------- WARNING: Minimal conditions NOT used !!! --------");
  } else {
    console.log("-------- Minimal conditions used --------");
  }
  let sourceFile = path.join(sourceFolder, inputFileName);
  let targetFile = path.join(rewardEpochFolder, REWARD_DISTRIBUTION_DATA_FILE);
  let data = JSON.parse(readFileSync(sourceFile, "utf8"), bigIntReviver);
  
  console.log("Writing to", targetFile);
  writeFileSync(targetFile, JSON.stringify(data, bigIntReplacerNoN, 2));

  // Tuples file
  const rewardClaims = data.rewardClaims;
  data.rewardClaims = rewardClaims.map(claim => tuplifyClaim(claim));
  targetFile = path.join(rewardEpochFolder, REWARD_DISTRIBUTION_DATA_TUPLES_FILE);
  console.log("Writing to", targetFile);
  writeFileSync(targetFile, JSON.stringify(data, bigIntReplacerNoN, 2));

  // Reward epoch info file
  sourceFile = path.join(sourceFolder, REWARD_EPOCH_INFO_FILE);
  targetFile = path.join(rewardEpochFolder, REWARD_EPOCH_INFO_FILE);
  data = JSON.parse(readFileSync(sourceFile, "utf8"), bigIntReviver);
  console.log("Writing to", targetFile);
  writeFileSync(targetFile, JSON.stringify(data, bigIntReplacerNoN, 2));

  // Minimal conditions file
  sourceFile = path.join(sourceFolder, MINIMAL_CONDITIONS_FILE);
  targetFile = path.join(rewardEpochFolder, MINIMAL_CONDITIONS_FILE);
  data = JSON.parse(readFileSync(sourceFile, "utf8"), bigIntReviver);
  console.log("Writing to", targetFile);
  writeFileSync(targetFile, JSON.stringify(data, bigIntReplacerNoN, 2));
  // Passes file
  sourceFile = path.join(sourceFolder, PASSES_FILE);
  targetFile = path.join(rewardEpochFolder, PASSES_FILE);
  data = JSON.parse(readFileSync(sourceFile, "utf8"), bigIntReviver);
  console.log("Writing to", targetFile);
  writeFileSync(targetFile, JSON.stringify(data, bigIntReplacerNoN, 2));




  // for (const fileName of files) {
  //   const sourceFile = path.join(sourceFolder, fileName);
  //   const targetFile = path.join(rewardEpochFolder, fileName);
  //   const data = JSON.parse(readFileSync(sourceFile, "utf8"), bigIntReviver);
  //   console.log("Writing to", targetFile);
  //   writeFileSync(targetFile, JSON.stringify(data, bigIntReplacerNoN, 2));
  // }


  // sourceFile = path.join(rewardEpochFolder, REWARD_DISTRIBUTION_DATA_FILE);
  // targetFile = path.join(rewardEpochFolder, REWARD_DISTRIBUTION_DATA_TUPLES_FILE);
  // data = JSON.parse(readFileSync(sourceFile, "utf8"));
  // const rewardClaims = data.rewardClaims;
  // data.rewardClaims = rewardClaims.map(claim => tuplifyClaim(claim));
  // console.log("Writing to", targetFile);
  // writeFileSync(targetFile, JSON.stringify(data, bigIntReplacerNoN, 2));
}

main()
  .then(() => {
    console.dir("Done");
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
