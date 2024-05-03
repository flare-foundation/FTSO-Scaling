import { EPOCH_SETTINGS, GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC } from "../../../libs/ftso-core/src/configs/networks";
import { printSignatureSummary, signatureSummary } from "../signature-stats";

async function main() {
  if (!process.argv[2]) {
    throw new Error("no rewardEpochId");
  }
  const rewardEpochId = parseInt(process.argv[2]);
  let signatureGracePeriodEndOffset;
  if (!process.argv[3]) {
    if (process.env.NETWORK === "coston" || process.env.NETWORK === "songbird") {
      signatureGracePeriodEndOffset =
        EPOCH_SETTINGS().revealDeadlineSeconds + GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC();
    } else {
      throw new Error("no signatureGracePeriodEndOffset");
    }
  } else {
    signatureGracePeriodEndOffset = parseInt(process.argv[3]);
  }
  console.log("signatureGracePeriodEndOffset", signatureGracePeriodEndOffset);
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
