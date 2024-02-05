/////////////// REWARDING CONSTANTS ////////////////////

/**
 * Penalty factor for reveal withdrawal. Given a weight relative share of a partial reward offer's amount
 * the value is multiplied by this factor to get the penalty amount.
 */
export const PENALTY_FACTOR = 10n; // voting rounds

/**
 * Grace period for signature submission starts immediately after the reveal deadline and lasts for this duration.
 * In this period signatures by voters are rewarded even if finalization comes earlier. Namely,
 * the signatures are rewarded if they are deposited before the timestamp of the first successful finalization.
 */
export const GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC = 10; // seconds

/**
 * Grace period for finalization submission starts immediately after the reveal deadline and lasts for this duration.
 * If selected voters submit or try to submit a correct finalization in this period, they are rewarded.
 * Selection of voters is done pseudo-randomly based on the hash of the voting round id and the protocol id.
 * See class RandomVoterSelector for more details.
 */
export const GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC = 20; // seconds

/**
 * Once the a voter gets attributed reward amount, partial claims of different types are generated.
 * These include fee and participation weight rewards. Participation weight includes staking
 * weight and WFLR delegation weight. Since both weights contribute to the voters weight
 * a part of the reward is distributed to the staking weight and a part to the delegation weight.
 * This constant defines the percentage of the reward that is distributed to the staking weight.
 * The rest is distributed to the delegation weight.
 */
export const SIGNING_REWARD_SPLIT_BIPS_TO_STAKE = 5000n; // BIPS (percentage)

/**
 * Price epoch reward offers are divided into three parts:
 * - 10% for finalizers
 * - 10% for signers
 * - 80%  + remainder for the median calculation results.
 * The constants below define the percentage of the reward that is distributed to the finalizers and signers.
 */
export const SIGNING_BIPS = 1000n;
export const FINALIZATION_BIPS = 1000n;

/**
 * BIPS and PPM total values.
 */
export const TOTAL_BIPS = 10000n;
export const TOTAL_PPM = 1000000n;

/**
 * In case less then certain percentage of the total weight of the voting weight deposits signatures for a single hash,
 * in the signature rewarding window, the signatures are not rewarded.
 * In case that exactly the same weight is deposited in the signature rewarding window, for multiple hashes (e.g. 2 hashes),
 * both get reward.
 */
export const MINIMAL_REWARDED_NON_CONSENSUS_DEPOSITED_SIGNATURES_PER_HASH_BIPS = 3000;
/**
 * The share of weight that gets randomly selected for finalization reward.
 */

export const FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS = 500;
