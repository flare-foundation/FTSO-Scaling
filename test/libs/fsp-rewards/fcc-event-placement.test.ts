import { expect } from "chai";
import { EPOCH_SETTINGS } from "../../../libs/ftso-core/src/constants";
import { fccEventVotingRound } from "../../../libs/fsp-rewards/src/reward-calculation/fcc/fcc-event-placement";
import { getTestFile } from "../../utils/getTestFile";

const EPOCH_FIRST = 1410720;
const EPOCH_LAST = 1410959; // 240 voting rounds, as on Coston2
const BATCH_SIZE = 40;

function timestampOf(votingRoundId: number): number {
  return EPOCH_SETTINGS().votingEpochStartSec(votingRoundId) + 1;
}

/** The batches a run is split into, exactly as reward-data-calculation.ts partitions the epoch. */
function batches(): [number, number][] {
  const result: [number, number][] = [];
  for (let first = EPOCH_FIRST; first <= EPOCH_LAST; first += BATCH_SIZE) {
    result.push([first, Math.min(first + BATCH_SIZE - 1, EPOCH_LAST)]);
  }
  return result;
}

/** How many batches record an event with this timestamp, and which round each places it in. */
function placements(timestampSec: number): number[] {
  return batches()
    .map(([first, last]) => fccEventVotingRound(timestampSec, EPOCH_FIRST, EPOCH_LAST, first, last))
    .filter((round): round is number => round !== undefined);
}

describe(`FCC event placement (${getTestFile(__filename)})`, () => {
  it("splits the epoch into the expected number of batches", () => {
    expect(batches().length).to.eq(6);
  });

  // The funding window spans the whole epoch, so every batch sees every event. Clamping into the batch rather than
  // the epoch made each batch keep all of them, multiplying Coston2 epoch 5878's fees by exactly six.
  it("records an event in exactly one batch, wherever it falls", () => {
    for (let votingRoundId = EPOCH_FIRST; votingRoundId <= EPOCH_LAST; votingRoundId += 7) {
      const placed = placements(timestampOf(votingRoundId));
      expect(placed, `voting round ${votingRoundId}`).to.deep.eq([votingRoundId]);
    }
  });

  it("records an event before the epoch's first round exactly once, in that first round", () => {
    // credited to this epoch, but paid before its first scheduled voting round
    expect(placements(timestampOf(EPOCH_FIRST - 5))).to.deep.eq([EPOCH_FIRST]);
  });

  it("records an event after the epoch's last round exactly once, in that last round", () => {
    // the on-chain epoch switch lags the schedule, so a fee credited to this epoch can be paid after its last round
    expect(placements(timestampOf(EPOCH_LAST + 5))).to.deep.eq([EPOCH_LAST]);
  });

  it("never loses an event: every round of the epoch is claimed by some batch", () => {
    for (let votingRoundId = EPOCH_FIRST; votingRoundId <= EPOCH_LAST; votingRoundId++) {
      expect(placements(timestampOf(votingRoundId)).length, `voting round ${votingRoundId}`).to.eq(1);
    }
  });

  it("places every event of a whole epoch exactly once across all batches", () => {
    // one event per voting round, plus one before the epoch and one after
    const timestamps = [timestampOf(EPOCH_FIRST - 3), timestampOf(EPOCH_LAST + 3)];
    for (let votingRoundId = EPOCH_FIRST; votingRoundId <= EPOCH_LAST; votingRoundId++) {
      timestamps.push(timestampOf(votingRoundId));
    }
    const totalPlacements = timestamps.reduce((total, ts) => total + placements(ts).length, 0);
    expect(totalPlacements).to.eq(timestamps.length);
  });
});
