import { printShortRewardEpochSummaries, shortRewardEpochSummaries } from "../reward-epoch-summary";

async function main() {
  if (!process.argv[2]) {
    throw new Error("no rewardEpochId");
  }
  const startRewardEpochId = parseInt(process.argv[2]);
  const endRewardEpochId = process.argv[3] ? parseInt(process.argv[3]) : startRewardEpochId;
  const data = shortRewardEpochSummaries(startRewardEpochId, endRewardEpochId);
  printShortRewardEpochSummaries(data);
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
