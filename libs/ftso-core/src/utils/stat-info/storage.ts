import fs from "fs";
import path from "path/posix";
import { CALCULATIONS_FOLDER } from "../../configs/networks";

/**
 * Destroys storage for a given reward epoch. It removes the folder.
 */
export function destroyStorage(rewardEpochId: number, calculationFolder = CALCULATIONS_FOLDER()) {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  if (fs.existsSync(rewardEpochFolder)) {
    fs.rmSync(rewardEpochFolder, { recursive: true });
  }
}
