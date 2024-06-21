import { feedSummary, printFeedSummary } from "../feed-stats";

async function main() {
  if (!process.argv[2]) {
    throw new Error("no rewardEpochId");
  }
  const rewardEpochId = parseInt(process.argv[2]);
  if (!process.argv[3]) {
    throw new Error("no feed id");
  }
  const feedId = process.argv[3];
  const startVotingRoundId = process.argv[4] ? parseInt(process.argv[4]) : undefined;
  const endVotingRoundId = process.argv[5] ? parseInt(process.argv[5]) : undefined;

  const data = await feedSummary(rewardEpochId, feedId, startVotingRoundId, endVotingRoundId);
  // console.dir(data, { depth: null });
  printFeedSummary(data);
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
