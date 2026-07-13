import { expect } from "chai";
import { RewardOffers } from "../../../libs/ftso-core/src/data/RewardOffers";
import { RevealData } from "../../../libs/ftso-core/src/data/RevealData";
import { rewardEpochFeedSequence } from "../../../libs/ftso-core/src/ftso-calculation/feed-ordering";
import { Feed } from "../../../libs/ftso-core/src/voting-types";
import { getTestFile } from "../../utils/getTestFile";

// These tests lock in the pre-/post-FIP.16 gating of two otherwise-ungated behavioural changes, so that a mixed
// v1.0.9 / new-release deployment agrees bit-for-bit before the activation epoch. See
// docs/migrations/FIP-16-consensus-gating.md.

const FEED_A = "0x414141414141414141414141414141414141414141"; // bytes21
const FEED_B = "0x424242424242424242424242424242424242424242";

function communityOffer(feedId: string, amount: bigint) {
  return {
    rewardEpochId: 1,
    feedId,
    decimals: 0,
    amount,
    minRewardedTurnoutBIPS: 100,
    primaryBandRewardSharePPM: 500000,
    secondaryBandWidthPPM: 100000,
    claimBackAddress: "offer",
  };
}

describe(`FIP.16 feed-ordering gating (${getTestFile(__filename)})`, () => {
  // Reviewer's case: feed A has two community offers [4, 4], feed B has one [10].
  // Pre-FIP.16 (v1.0.9) accumulation double-counts the running total: A = ((0+4) doubled +4) = 12 > B = 10 -> [A, B].
  // From FIP.16 the accumulation is the plain sum: A = 4+4 = 8 < B = 10 -> [B, A].
  const rewardOffers: RewardOffers = {
    inflationOffers: [],
    rewardOffers: [communityOffer(FEED_A, 4n), communityOffer(FEED_A, 4n), communityOffer(FEED_B, 10n)],
  } as unknown as RewardOffers;

  it("reproduces the v1.0.9 double-counting order when FIP.16 is inactive", () => {
    const seq = rewardEpochFeedSequence(rewardOffers, false);
    expect(seq.map((f) => f.id)).to.deep.equal([FEED_A.toLowerCase(), FEED_B.toLowerCase()]);
  });

  it("uses the corrected plain-sum order once FIP.16 is active", () => {
    const seq = rewardEpochFeedSequence(rewardOffers, true);
    expect(seq.map((f) => f.id)).to.deep.equal([FEED_B.toLowerCase(), FEED_A.toLowerCase()]);
  });

  it("is identical across the gate when no feed has repeated offers", () => {
    const single: RewardOffers = {
      inflationOffers: [],
      rewardOffers: [communityOffer(FEED_A, 4n), communityOffer(FEED_B, 10n)],
    } as unknown as RewardOffers;
    expect(rewardEpochFeedSequence(single, false).map((f) => f.id)).to.deep.equal(
      rewardEpochFeedSequence(single, true).map((f) => f.id)
    );
  });
});

describe(`FIP.16 random-only reveal gating (${getTestFile(__filename)})`, () => {
  const feeds: Feed[] = [{ id: "0x4254430055534400", decimals: 0 }];
  const randomOnly = "0x" + "ab".repeat(32); // 32-byte random, no feed bytes (length 66)
  const withValue = randomOnly + "0000000a"; // one 4-byte feed value appended

  it("rejects a random-only reveal before FIP.16 (matches v1.0.9 skip)", () => {
    expect(() => RevealData.decode(randomOnly, feeds, false)).to.throw("random-only reveal");
  });

  it("accepts a random-only reveal from FIP.16 as all-empty feed values", () => {
    const decoded = RevealData.decode(randomOnly, feeds, true);
    expect(decoded.random).to.equal(randomOnly);
    expect(decoded.valuesWithDecimals).to.have.lengthOf(1);
    expect(decoded.valuesWithDecimals[0].isEmpty).to.equal(true);
  });

  it("defaults to accepting (current behaviour) when the flag is omitted", () => {
    expect(() => RevealData.decode(randomOnly, feeds)).to.not.throw();
  });

  it("is unaffected by the gate when the reveal carries feed values", () => {
    expect(() => RevealData.decode(withValue, feeds, false)).to.not.throw();
    const a = RevealData.decode(withValue, feeds, false);
    const b = RevealData.decode(withValue, feeds, true);
    expect(a.encodedValues).to.equal(b.encodedValues);
  });
});
