import { claimsToCSV } from "../reward-claims-csv";

async function main() {
  if (!process.argv[2]) {
    throw new Error("no filename");
  }
  const filename = process.argv[2];
  if (!process.argv[3]) {
    throw new Error("No start reward epoch Id");
  }
  const rewardEpochId = parseInt(process.argv[3]);
  let endRewardEpoch = rewardEpochId;

  if (process.argv[4]) {
    endRewardEpoch = parseInt(process.argv[4]);
  }

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
