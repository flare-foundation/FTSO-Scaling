import { EPOCH_SETTINGS } from "../../../../ftso-core/src/constants";

/**
 * Decides which voting round an FCC fee event is recorded against, for one batch of voting rounds.
 *
 * The funding window is bounded by the `RewardEpochStarted` events and so spans the whole reward epoch, which means
 * **every batch of voting rounds sees every event in the epoch**. Two rules follow, and they are the whole point of
 * this function:
 *
 * - the event is placed in the round of its timestamp clamped into the **reward epoch's** range, never the batch's.
 *   The window overshoots the epoch at both ends, so a fee paid after the last scheduled round but still credited to
 *   this epoch belongs to its final round;
 * - it is then recorded only by the batch that owns that round.
 *
 * Clamping into the batch instead would make every batch keep every event, and the epoch's fees would be counted
 * once per batch. That is not hypothetical: it multiplied Coston2 reward epoch 5878 by exactly six, its 240 voting
 * rounds over batches of 40.
 *
 * @returns the voting round to record the event against, or undefined when it belongs to another batch.
 */
export function fccEventVotingRound(
  eventTimestampSec: number,
  epochFirstVotingRoundId: number,
  epochLastVotingRoundId: number,
  batchFirstVotingRoundId: number,
  batchLastVotingRoundId: number
): number | undefined {
  const votingRoundId = EPOCH_SETTINGS().votingEpochForTimeSec(eventTimestampSec);
  const clamped = Math.min(Math.max(votingRoundId, epochFirstVotingRoundId), epochLastVotingRoundId);
  if (clamped < batchFirstVotingRoundId || clamped > batchLastVotingRoundId) {
    return undefined;
  }
  return clamped;
}
