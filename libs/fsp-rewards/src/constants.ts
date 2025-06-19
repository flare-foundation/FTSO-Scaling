import { networks } from "../../contracts/src/constants";

export const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

// Protocol ids
const ftso2FastUpdatesProtocolId = () => {
    const network = process.env.NETWORK as networks;
    switch (network) {
        case "coston":
        case "from-env":
        case "local-test":
        case "coston2":
        case "songbird":
        case "flare":
            return 255;
        default:
            // Ensure exhaustive checking
            // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
            ((_: never): void => { })(network);
    }
};

// Protocol id for FTSO2 fast updates
export const FTSO2_FAST_UPDATES_PROTOCOL_ID = ftso2FastUpdatesProtocolId();


const FDCProtocolId = () => {
    const network = process.env.NETWORK as networks;
    switch (network) {
        case "coston":
        case "from-env":
        case "local-test":
        case "coston2":
        case "songbird":
        case "flare":
            return 200;
        default:
            // Ensure exhaustive checking
            // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
            ((_: never): void => { })(network);
    }
};

// Protocol id for FDC
export const FDC_PROTOCOL_ID = FDCProtocolId();

export const STAKING_PROTOCOL_ID = 0;

/**
 * The number of additional voting rounds for performing queries for signature and finalization data.
 * If value is 0, then for votingRoundId the original window is from the end of reveals to the end
 * of the voting epoch votingRoundId. If value is bigger, it extends to ends of the next epochs accordingly.
 */
const additionalRewardFinalizationWindows = () => {
    const network = process.env.NETWORK as networks;
    switch (network) {
        case "from-env":
        case "coston":
        case "coston2":
        case "songbird":
        case "flare":
        case "local-test":
            return 0;
        default:
            // Ensure exhaustive checking
            // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
            ((_: never): void => { })(network);
    }
};

export const ADDITIONAL_REWARDED_FINALIZATION_WINDOWS = additionalRewardFinalizationWindows();

const burnAddress = () => {
    const network = process.env.NETWORK as networks;
    switch (network) {
        case "from-env":
        case "local-test":
        case "coston2":
        case "coston":
            return "0x000000000000000000000000000000000000dEaD";
        case "songbird":
            return "0xAC3F85d29119836545670b2FCeFe35C829bE35ab"; // SGB burn address
        case "flare":
            return "0xD9e5B450773B17593abAfCF73aB96ad99d589751";
        default:
            // Ensure exhaustive checking
            // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
            ((_: never): void => {
            })(network);
    }
};
export const BURN_ADDRESS = burnAddress();

function extractIntegerNonNegativeValueFromEnv(envVar: string): number {
    if (!process.env[envVar]) {
        throw new Error(`${envVar} value is not provided`);
    }
    try {
        const num = parseInt(process.env[envVar]);
        if (num >= 0) {
            return num;
        }
        throw new Error(`${envVar} must be a non negative integer`);
    } catch {
        throw new Error(`${envVar} must be an integer`);
    }
}

function extractBigIntNonNegativeValueFromEnv(envVar: string): bigint {
    if (!process.env[envVar]) {
        throw new Error(`${envVar} value is not provided`);
    }
    try {
        const num = BigInt(process.env[envVar]);
        if (num >= 0) {
            return num;
        }
        throw new Error(`${envVar} must be a non negative integer`);
    } catch {
        throw new Error(`${envVar} must be an integer`);
    }
}

/**
 * Penalty factor for reveal withdrawal. Given a weight relative share of a partial reward offer's amount
 * the value is multiplied by this factor to get the penalty amount.
 */
const penaltyFactor = () => {
    const network = process.env.NETWORK as networks;
    switch (network) {
        case "from-env":
            return extractBigIntNonNegativeValueFromEnv("PENALTY_FACTOR");
        case "coston":
            return 30n;
        case "coston2":
            return 30n;
        case "songbird":
            return 30n;
        case "flare":
            return 30n;
        case "local-test":
            return 30n;
        default:
            // Ensure exhaustive checking
            // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
            ((_: never): void => {
            })(network);
    }
};
const constantPenaltyFactor = penaltyFactor();
export const PENALTY_FACTOR = () => {
    if (process.env.NETWORK === "from-env") {
        return penaltyFactor();
    }
    return constantPenaltyFactor;
};
/**
 * Grace period for signature submission starts immediately after the reveal deadline and lasts for this duration.
 * In this period signatures by voters are rewarded even if finalization comes earlier. Namely,
 * the signatures are rewarded if they are deposited before the timestamp of the first successful finalization.
 */
const gracePeriodForSignaturesDurationSec = () => {
    const network = process.env.NETWORK as networks;
    switch (network) {
        case "from-env":
            return extractIntegerNonNegativeValueFromEnv("GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC");
        case "coston":
            return 15; // 15 seconds
        case "coston2":
            return 15; // 15 seconds
        case "songbird":
            return 15; // 15 seconds
        case "flare":
            return 15; // 15 seconds
        case "local-test":
            return 15; // 15 seconds
        default:
            // Ensure exhaustive checking
            // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
            ((_: never): void => {
            })(network);
    }
};
const constantGracePeriodForSignaturesDurationSec = gracePeriodForSignaturesDurationSec();
export const GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC = () => {
    if (process.env.NETWORK === "from-env") {
        return gracePeriodForSignaturesDurationSec();
    }
    return constantGracePeriodForSignaturesDurationSec;
};
/**
 * Grace period for finalization submission starts immediately after the reveal deadline and lasts for this duration.
 * If selected voters submit or try to submit a correct finalization in this period, they are rewarded.
 * Selection of voters is done pseudo-randomly based on the hash of the voting round id and the protocol id.
 * See class RandomVoterSelector for more details.
 */

const gracePeriodForFinalizationDurationSec = () => {
    const network = process.env.NETWORK as networks;
    switch (network) {
        case "from-env":
            return extractIntegerNonNegativeValueFromEnv("GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC");
        case "coston":
            return 20; // seconds
        case "coston2":
            return 20; // seconds
        case "songbird":
            return 20; // seconds
        case "flare":
            return 20; // 20 seconds
        case "local-test":
            return 20; // seconds
        default:
            // Ensure exhaustive checking
            // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
            ((_: never): void => {
            })(network);
    }
};
const constantGracePeriodForFinalizationDurationSec = gracePeriodForFinalizationDurationSec();
export const GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC = () => {
    if (process.env.NETWORK === "from-env") {
        return gracePeriodForFinalizationDurationSec();
    }
    return constantGracePeriodForFinalizationDurationSec;
};
/**
 * Voting round reward offers are divided into three parts:
 * - 10% for finalizers
 * - 10% for signers
 * - 80%  + remainder for the median calculation results.
 * The constants below define the percentage of the reward that is distributed to the finalizers and signers.
 */
export const SIGNING_BIPS = () => 1000n;
export const FINALIZATION_BIPS = () => 1000n;
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
const minimalRewardedNonConsensusDepositedSignaturesPerHashBips = () => {
    const network = process.env.NETWORK as networks;
    switch (network) {
        case "from-env":
            return extractIntegerNonNegativeValueFromEnv("MINIMAL_REWARDED_NON_CONSENSUS_DEPOSITED_SIGNATURES_PER_HASH_BIPS");
        case "coston":
            return 3000;
        case "coston2":
            return 3000;
        case "songbird":
            return 3000;
        case "flare":
            return 3000;
        case "local-test":
            return 3000;
        default:
            // Ensure exhaustive checking
            // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
            ((_: never): void => {
            })(network);
    }
};
const constantMinimalRewardedNonConsensusDepositedSignaturesPerHashBips =
    minimalRewardedNonConsensusDepositedSignaturesPerHashBips();
export const MINIMAL_REWARDED_NON_CONSENSUS_DEPOSITED_SIGNATURES_PER_HASH_BIPS = () => {
    if (process.env.NETWORK === "from-env") {
        return minimalRewardedNonConsensusDepositedSignaturesPerHashBips();
    }
    return constantMinimalRewardedNonConsensusDepositedSignaturesPerHashBips;
};
/**
 * The share of weight that gets randomly selected for finalization reward.
 */
const finalizationVoterSelectionThresholdWeightBips = () => {
    const network = process.env.NETWORK as networks;
    switch (network) {
        case "from-env":
            return extractIntegerNonNegativeValueFromEnv("FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS");
        case "coston":
            return 500;
        case "coston2":
            return 500;
        case "songbird":
            return 500;
        case "flare":
            return 500;
        case "local-test":
            return 500;
        default:
            // Ensure exhaustive checking
            // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
            ((_: never): void => {
            })(network);
    }
};
const constantFinalizationVoterSelectionThresholdWeightBips = finalizationVoterSelectionThresholdWeightBips();
export const FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS = () => {
    if (process.env.NETWORK === "from-env") {
        return finalizationVoterSelectionThresholdWeightBips();
    }
    return constantFinalizationVoterSelectionThresholdWeightBips;
};
/**
 * For signing and finalization rewards in grace period delegation fee is used.
 * In future mirrored staking fee will be used. Since a malicious voter could still have stake in the system
 * while changing the delegation fee and stakers are locked into the stake, the cap is the protection
 * against the malicious behavior.
 */
export const CAPPED_STAKING_FEE_BIPS = 2000;
export const CALCULATIONS_FOLDER = () => {
    const network = process.env.NETWORK as networks;
    switch (network) {
        case "from-env":
            return "calculations/from-env";
        case "coston":
            return "calculations/coston";
        case "coston2":
            return "calculations/coston2";
        case "songbird":
            return "calculations/songbird";
        case "flare":
            return "calculations/flare";
        case "local-test":
            return "calculations/local-test";
        default:
            // Ensure exhaustive checking
            // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
            ((_: never): void => {
            })(network);
    }
};
export const FEEDS_RENAMING_FILE = () => "libs/fsp-rewards/src/reward-calculation/feeds-renaming.json";
export const FUTURE_VOTING_ROUNDS = () => 30;
// Used to limit querying of too old events and handling the missing event for the voting round
export const COSTON_FAST_UPDATER_SWITCH_VOTING_ROUND_ID = 779191;
// set to start voting round id of epoch 234
// on Songbird there was no missing event for the voting round
// Only used to filter out the old events
export const SONGBIRD_FAST_UPDATER_SWITCH_VOTING_ROUND_ID = 786240;
export const WRONG_SIGNATURE_INDICATOR_MESSAGE_HASH = "WRONG_SIGNATURE";
export const STAKING_DATA_BASE_FOLDER = "staking-data";
export const STAKING_DATA_FOLDER = () => {
    const network = process.env.NETWORK as networks;
    const STAKING_DATA_BASE_FOLDER = "staking-data";
    switch (network) {
        case "from-env":
            return `${STAKING_DATA_BASE_FOLDER}/from-env`;
        case "coston":
            return `${STAKING_DATA_BASE_FOLDER}/coston`;
        case "coston2":
            return `${STAKING_DATA_BASE_FOLDER}/coston2`;
        case "songbird":
            return `${STAKING_DATA_BASE_FOLDER}/songbird`;
        case "flare":
            return `${STAKING_DATA_BASE_FOLDER}/flare`;
        case "local-test":
            return `${STAKING_DATA_BASE_FOLDER}/local-test`;
        default:
            // Ensure exhaustive checking
            // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
            ((_: never): void => {
            })(network);
    }
};
export const PASSES_DATA_FOLDER = () => {
    const network = process.env.NETWORK as networks;
    const PASSES_DATA_BASE_FOLDER = "passes-data";
    switch (network) {
        case "from-env":
            return `${PASSES_DATA_BASE_FOLDER}/from-env`;
        case "coston":
            return `${PASSES_DATA_BASE_FOLDER}/coston`;
        case "coston2":
            return `${PASSES_DATA_BASE_FOLDER}/coston2`;
        case "songbird":
            return `${PASSES_DATA_BASE_FOLDER}/songbird`;
        case "flare":
            return `${PASSES_DATA_BASE_FOLDER}/flare`;
        case "local-test":
            return `${PASSES_DATA_BASE_FOLDER}/local-test`;
        default:
            // Ensure exhaustive checking
            // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
            ((_: never): void => {
            })(network);
    }
};