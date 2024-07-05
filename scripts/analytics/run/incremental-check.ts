import { readFileSync } from "fs";
import path from "path/posix";
import { CALCULATIONS_FOLDER } from "../../../libs/ftso-core/src/configs/networks";
import { bigIntReviver } from "../../../libs/ftso-core/src/utils/big-number-serialization";
import { TEMPORARY_INCREMENTAL_FEED_SELECTION_FILE } from "../../../libs/ftso-core/src/utils/stat-info/constants";
import { deserializeGranulatedPartialOfferMap } from "../../../libs/ftso-core/src/utils/stat-info/granulated-partial-offers-map";
import { IncrementalCalculationsFeedSelections } from "../../../libs/ftso-core/src/utils/stat-info/incremental-calculation-temp-selected-feeds";

async function main() {
  if (!process.argv[2]) {
    throw new Error("no reward epoch id");
  }
  const rewardEpochId = parseInt(process.argv[2]);
  const rewardEpochFolder = path.join(
    CALCULATIONS_FOLDER(),
    `${rewardEpochId}`
  );
  const feedSelectionsFile = path.join(rewardEpochFolder, TEMPORARY_INCREMENTAL_FEED_SELECTION_FILE);
  const data = JSON.parse(readFileSync(feedSelectionsFile, "utf-8"), bigIntReviver) as IncrementalCalculationsFeedSelections;
  for(const item of data.feedSelections) {
    const votingRoundId = item.votingRoundId;
    const feed = item.feed.id;
    const feedOffers = deserializeGranulatedPartialOfferMap(rewardEpochId, votingRoundId, CALCULATIONS_FOLDER());
    const realFeed = [...feedOffers.keys()][0];
    if(realFeed !== feed) {
      console.log(`Feed mismatch for voting round ${votingRoundId}: ${realFeed} vs ${feed}`);
    }
  }
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
