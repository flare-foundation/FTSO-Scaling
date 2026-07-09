import { expect } from "chai";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path/posix";
import { bigIntReplacer } from "../../../libs/ftso-core/src/utils/big-number-serialization";
import { CALCULATIONS_FOLDER, FDC_FIRE_FEE_SPLIT_BIPS } from "../../../libs/fsp-rewards/src/constants";
import { granulatedPartialOfferMapForFDC } from "../../../libs/fsp-rewards/src/reward-calculation/reward-offers";
import {
  FDC_ATTESTATION_APPEARANCES_FILE,
  REWARD_CALCULATION_DATA_FILE,
} from "../../../libs/fsp-rewards/src/utils/stat-info/constants";
import { RewardEpochInfo } from "../../../libs/fsp-rewards/src/utils/stat-info/reward-epoch-info";
import { getTestFile } from "../../utils/getTestFile";

const FIRE_POOL_ADDRESS_FLARE = "0x0ce6831DF00A6018c4d316009980DbAa6c44E525";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

// Re-evaluates libs/fsp-rewards/src/constants under the given NETWORK to observe per-network constant values.
function freshConstants(network: string): typeof import("../../../libs/fsp-rewards/src/constants") {
  const modulePath = require.resolve("../../../libs/fsp-rewards/src/constants");
  const originalNetwork = process.env.NETWORK;
  process.env.NETWORK = network;
  delete require.cache[modulePath];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return
    return require("../../../libs/fsp-rewards/src/constants");
  } finally {
    delete require.cache[modulePath];
    if (originalNetwork === undefined) {
      delete process.env.NETWORK;
    } else {
      process.env.NETWORK = originalNetwork;
    }
  }
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const original = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    original.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    fn();
  } finally {
    for (const [key, value] of original.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe(`FDC FIRE fee split constants (${getTestFile(__filename)})`, () => {
  it("uses the FIRE pool address and a 9000 bips split on Flare", () => {
    const constants = freshConstants("flare");
    expect(constants.FIRE_POOL_ADDRESS).to.eq(FIRE_POOL_ADDRESS_FLARE);
    expect(constants.FDC_FIRE_FEE_SPLIT_BIPS()).to.eq(9000n);
  });

  for (const network of ["songbird", "coston", "coston2", "local-test"]) {
    it(`uses the dead address and a 0 bips split on ${network}`, () => {
      const constants = freshConstants(network);
      expect(constants.FIRE_POOL_ADDRESS).to.eq(DEAD_ADDRESS);
      expect(constants.FDC_FIRE_FEE_SPLIT_BIPS()).to.eq(0n);
    });
  }

  it("treats an absent or blank from-env split as 0 bips", () => {
    withEnv({ NETWORK: "from-env", FDC_FIRE_FEE_SPLIT_BIPS: undefined }, () => {
      expect(FDC_FIRE_FEE_SPLIT_BIPS()).to.eq(0n);
    });
    withEnv({ NETWORK: "from-env", FDC_FIRE_FEE_SPLIT_BIPS: "  " }, () => {
      expect(FDC_FIRE_FEE_SPLIT_BIPS()).to.eq(0n);
    });
  });

  it("uses the from-env split when provided", () => {
    withEnv({ NETWORK: "from-env", FDC_FIRE_FEE_SPLIT_BIPS: "9000" }, () => {
      expect(FDC_FIRE_FEE_SPLIT_BIPS()).to.eq(9000n);
    });
  });

  for (const invalidValue of ["90a", "-1", "4.2", "10001"]) {
    it(`rejects malformed from-env split ${invalidValue}`, () => {
      withEnv({ NETWORK: "from-env", FDC_FIRE_FEE_SPLIT_BIPS: invalidValue }, () => {
        expect(() => FDC_FIRE_FEE_SPLIT_BIPS()).to.throw(
          "FDC_FIRE_FEE_SPLIT_BIPS must be an integer number of bips between 0 and 10000"
        );
      });
    });
  }
});

describe(`FDC FIRE fee split in granulated offers (${getTestFile(__filename)})`, () => {
  const REWARD_EPOCH_ID = 998877;
  const START_VOTING_ROUND_ID = 1000;
  const END_VOTING_ROUND_ID = 1001;
  const INFLATION_AMOUNT = 1000n; // 500n per voting round
  const ATTESTATION_TYPE = "0x" + "61".repeat(32);
  const SOURCE = "0x" + "62".repeat(32);
  const REQUEST_PREFIX = ATTESTATION_TYPE + SOURCE.slice(2);

  const originalEnv = new Map<string, string | undefined>();
  let calculationFolder: string;

  const rewardEpochInfo = {
    rewardEpochId: REWARD_EPOCH_ID,
    signingPolicy: { startVotingRoundId: START_VOTING_ROUND_ID },
    endVotingRoundId: END_VOTING_ROUND_ID,
    fdcInflationRewardsOffered: {
      amount: INFLATION_AMOUNT,
      fdcConfigurations: [
        {
          attestationType: ATTESTATION_TYPE,
          source: SOURCE,
          inflationShare: 100,
          minRequestsThreshold: 1,
        },
      ],
    },
  } as unknown as RewardEpochInfo;

  before(() => {
    for (const key of ["NETWORK", "FDC_FIRE_FEE_SPLIT_BIPS", "FIP16_ACTIVATION_REWARD_EPOCH"]) {
      originalEnv.set(key, process.env[key]);
    }
    process.env.NETWORK = "from-env";
    delete process.env.FDC_FIRE_FEE_SPLIT_BIPS;
    delete process.env.FIP16_ACTIVATION_REWARD_EPOCH;

    calculationFolder = CALCULATIONS_FOLDER();
    const rewardEpochFolder = path.join(calculationFolder, `${REWARD_EPOCH_ID}`);
    rmSync(rewardEpochFolder, { recursive: true, force: true });
    mkdirSync(rewardEpochFolder, { recursive: true });
    writeFileSync(
      path.join(rewardEpochFolder, FDC_ATTESTATION_APPEARANCES_FILE),
      JSON.stringify([
        { attestationRequestId: REQUEST_PREFIX.toLowerCase(), attestationType: "a", source: "b", count: 3 },
      ])
    );
    // voting round 1000: confirmed fees 100n, unconfirmed fees 50n; voting round 1001: confirmed fees 101n
    const requestsPerRound: Record<number, object[]> = {
      [START_VOTING_ROUND_ID]: [
        { data: REQUEST_PREFIX, fee: 100n, confirmed: true, duplicate: false },
        { data: REQUEST_PREFIX, fee: 50n, confirmed: false, duplicate: false },
      ],
      [END_VOTING_ROUND_ID]: [{ data: REQUEST_PREFIX, fee: 101n, confirmed: true, duplicate: false }],
    };
    for (const [votingRoundId, attestationRequests] of Object.entries(requestsPerRound)) {
      const votingRoundFolder = path.join(rewardEpochFolder, votingRoundId);
      mkdirSync(votingRoundFolder);
      writeFileSync(
        path.join(votingRoundFolder, REWARD_CALCULATION_DATA_FILE),
        JSON.stringify({ fdcData: { attestationRequests } }, bigIntReplacer)
      );
    }
  });

  after(() => {
    if (calculationFolder && existsSync(path.join(calculationFolder, `${REWARD_EPOCH_ID}`))) {
      rmSync(path.join(calculationFolder, `${REWARD_EPOCH_ID}`), { recursive: true });
    }
    for (const [key, value] of originalEnv.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  afterEach(() => {
    delete process.env.FDC_FIRE_FEE_SPLIT_BIPS;
    delete process.env.FIP16_ACTIVATION_REWARD_EPOCH;
  });

  it("keeps the pre-FIP.16 offers while FIP.16 is not active", () => {
    process.env.FDC_FIRE_FEE_SPLIT_BIPS = "9000";
    const offerMap = granulatedPartialOfferMapForFDC(rewardEpochInfo);
    const offers = offerMap.get(START_VOTING_ROUND_ID);
    expect(offers.length).to.eq(2);
    const [offer, burnOffer] = offers;
    expect(offer.amount).to.eq(600n); // 500n inflation + 100n confirmed fees
    expect(offer.feeAmount).to.eq(100n);
    expect(offer.feeBurnAmount).to.eq(50n);
    expect(offer.fireFeeAmount).to.eq(undefined);
    expect(burnOffer.amount).to.eq(50n);
    expect(burnOffer.shouldBeBurned).to.eq(true);
  });

  it("carves the FIRE share out of confirmed fees once FIP.16 is active", () => {
    process.env.FIP16_ACTIVATION_REWARD_EPOCH = `${REWARD_EPOCH_ID}`;
    process.env.FDC_FIRE_FEE_SPLIT_BIPS = "9000";
    const offerMap = granulatedPartialOfferMapForFDC(rewardEpochInfo);

    const offers = offerMap.get(START_VOTING_ROUND_ID);
    expect(offers.length).to.eq(3);
    const [offer, burnOffer, fireOffer] = offers;
    expect(offer.amount).to.eq(510n); // 500n inflation + 100n confirmed fees - 90n FIRE share
    expect(offer.feeAmount).to.eq(100n);
    expect(offer.feeBurnAmount).to.eq(50n);
    expect(offer.fireFeeAmount).to.eq(90n);
    // fees of unconfirmed requests are fully burned, not split
    expect(burnOffer.amount).to.eq(50n);
    expect(burnOffer.shouldBeBurned).to.eq(true);
    expect(fireOffer.amount).to.eq(90n);
    expect(fireOffer.shouldGoToFirePool).to.eq(true);
    // value is conserved: inflation share + all fees
    expect(offer.amount + burnOffer.amount + fireOffer.amount).to.eq(500n + 100n + 50n);

    // rounding remainder stays distributable: floor(101n * 9000 / 10000) = 90n
    const [offer2, burnOffer2, fireOffer2] = offerMap.get(END_VOTING_ROUND_ID);
    expect(fireOffer2.amount).to.eq(90n);
    expect(offer2.amount).to.eq(511n); // 500n inflation + 101n confirmed fees - 90n FIRE share
    expect(burnOffer2.amount).to.eq(0n);
  });

  it("creates no FIRE offer when the split is 0 bips even if FIP.16 is active", () => {
    process.env.FIP16_ACTIVATION_REWARD_EPOCH = `${REWARD_EPOCH_ID}`;
    const offerMap = granulatedPartialOfferMapForFDC(rewardEpochInfo);
    const offers = offerMap.get(START_VOTING_ROUND_ID);
    expect(offers.length).to.eq(2);
    expect(offers[0].amount).to.eq(600n);
    expect(offers[0].fireFeeAmount).to.eq(undefined);
  });
});
