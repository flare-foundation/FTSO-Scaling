import {
  EPOCH_SETTINGS,

} from "../../../libs/ftso-core/src/constants";
import { finalizationSummary, printFinalizationSummary } from "../finalization-stats";
import {GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC} from "../../../libs/fsp-rewards/src/constants";

async function main() {
  if (!process.argv[2]) {
    throw new Error("no rewardEpochId");
  }
  const rewardEpochId = parseInt(process.argv[2]);
  let finalizationGracePeriodEndOffset;
  if (!process.argv[3]) {
    if (process.env.NETWORK === "coston" || process.env.NETWORK === "songbird" || process.env.NETWORK === "flare") {
      finalizationGracePeriodEndOffset =
        EPOCH_SETTINGS().revealDeadlineSeconds + GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC();
    } else {
      throw new Error("no finalizationGracePeriodEndOffset");
    }
  } else {
    finalizationGracePeriodEndOffset = parseInt(process.argv[3]);
  }
  console.log(`finalizationGracePeriodEndOffset: ${finalizationGracePeriodEndOffset}`);
  const endVotingRoundId = process.argv[4] ? parseInt(process.argv[4]) : undefined;
  const data = await finalizationSummary(rewardEpochId, finalizationGracePeriodEndOffset, endVotingRoundId);
  printFinalizationSummary(data);
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
