import { existsSync, mkdirSync, readFileSync, write, writeFileSync } from "fs";
import path from "path/posix";
import { REWARD_DISTRIBUTION_DATA_FILE, REWARD_DISTRIBUTION_DATA_TUPLES_FILE, REWARD_EPOCH_INFO_FILE } from "../../../libs/ftso-core/src/utils/stat-info/constants";
import { CALCULATIONS_FOLDER } from "../../../libs/ftso-core/src/configs/networks";
import { bigIntReviver } from "../../../libs/ftso-core/src/utils/big-number-serialization";
import { IRewardClaimWithProof } from "../../../libs/ftso-core/src/utils/RewardClaim";

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
  if(network !== "coston" && network !== "coston2" && network !== "songbird" && network !== "flare") {
    throw new Error(`invalid network: ${network}`);
  }

  if (!process.argv[3]) {
    throw new Error("no rewardEpochId");
  }
  const rewardEpochId = parseInt(process.argv[3]);

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

  const files = [
    REWARD_DISTRIBUTION_DATA_FILE, 
    REWARD_EPOCH_INFO_FILE
  ];
  process.env.NETWORK = network;
  const sourceFolder = path.join(CALCULATIONS_FOLDER(), `${rewardEpochId}`);

  for(const fileName of files) {
    const sourceFile = path.join(sourceFolder, fileName);
    const targetFile = path.join(rewardEpochFolder, fileName);
    const data = JSON.parse(readFileSync(sourceFile, "utf8"), bigIntReviver);
    console.log("Writing to", targetFile);
    writeFileSync(targetFile, JSON.stringify(data, bigIntReplacerNoN, 2));
  }

  const sourceFile = path.join(rewardEpochFolder, REWARD_DISTRIBUTION_DATA_FILE);
  const targetFile = path.join(rewardEpochFolder, REWARD_DISTRIBUTION_DATA_TUPLES_FILE);
  const data = JSON.parse(readFileSync(sourceFile, "utf8"));
  const rewardClaims = data.rewardClaims;
  data.rewardClaims = rewardClaims.map(claim => tuplifyClaim(claim));
  console.log("Writing to", targetFile);
  writeFileSync(targetFile, JSON.stringify(data, bigIntReplacerNoN, 2));
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
