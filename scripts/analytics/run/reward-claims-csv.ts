import { existsSync, mkdirSync } from "fs";
import { claimsToCSV } from "../reward-claims-csv";
import path from "path/posix";

const EXPORT_CSV_FOLDER = "exports-csv"
async function main() {
  const network = process.env.NETWORK;
  if(network !== "coston" && network !== "coston2" && network !== "songbird" && network !== "flare") {
    throw new Error(`invalid network: '${network}'`);
  }

  if (!process.argv[2]) {
    throw new Error("No reward epoch Id");
  }
  const rewardEpochId = parseInt(process.argv[2]);
 
  let endRewardEpoch = rewardEpochId;
  if(process.argv[3]) {
    endRewardEpoch = parseInt(process.argv[3]);
  }
  if (!existsSync(EXPORT_CSV_FOLDER)) {
    mkdirSync(EXPORT_CSV_FOLDER);
  }
  let fname = `${rewardEpochId}.csv`;
  if(endRewardEpoch !== rewardEpochId) {
    fname = `${rewardEpochId}-${endRewardEpoch}.csv`;
  }
  const networkFolder = path.join(EXPORT_CSV_FOLDER, `${network}`);
  if (!existsSync(networkFolder)) {
    mkdirSync(networkFolder);
  }

  const filename = path.join(networkFolder, fname);

  claimsToCSV(rewardEpochId, endRewardEpoch, filename);
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
