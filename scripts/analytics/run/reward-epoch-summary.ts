import { latestRewardEpochIdWithCalculatedData } from "../../stats-utils";
import { printShortRewardEpochSummaries, shortRewardEpochSummaries } from "../reward-epoch-summary";

async function main() {
  let startRewardEpochId = parseInt(process.argv[2]);
  if (!process.argv[2]) {
    if (process.env.NETWORK === "coston") {
      startRewardEpochId = 2380;
    } else {
      throw new Error("no rewardEpochId");
    }
  } else {
    startRewardEpochId = parseInt(process.argv[2]);
  }
  const endRewardEpochId = process.argv[3] ? parseInt(process.argv[3]) : latestRewardEpochIdWithCalculatedData();
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
