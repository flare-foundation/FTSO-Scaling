import { printSignatureSummary, signatureSummary } from "../signature-stats";

async function main() {
  if (!process.argv[2]) {
    throw new Error("no rewardEpochId");
  }
  const rewardEpochId = parseInt(process.argv[2]);
  if (!process.argv[3]) {
    throw new Error("no signatureGracePeriodEndOffset");
  }
  const signatureGracePeriodEndOffset = parseInt(process.argv[3]);
  const endVotingRoundId = process.argv[4] ? parseInt(process.argv[4]) : undefined;
  const data = await signatureSummary(rewardEpochId, signatureGracePeriodEndOffset, endVotingRoundId);
  printSignatureSummary(data);
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
