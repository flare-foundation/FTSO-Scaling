import { expect } from "chai";
import { CommitData } from "../../../libs/ftso-core/src/data/CommitData";
import { FeedValueEncoder } from "../../../libs/ftso-core/src/data/FeedValueEncoder";
import { RevealData } from "../../../libs/ftso-core/src/data/RevealData";
import { Feed } from "../../../libs/ftso-core/src/voting-types";
import { getTestFile } from "../../utils/getTestFile";

describe(`RevealData (${getTestFile(__filename)})`, () => {
  const feeds: Feed[] = [{ id: "0000000000000000", decimals: 2 }];
  const random = "0x" + "ab".repeat(32); // 32-byte random
  const voter = "0x" + "00".repeat(20);

  // Regression for the empty-reveal round-halt: an empty "0x" reveal used to decode with random="0x",
  // which then threw when hashed as a uint256 in CommitData.hashForCommit, aborting the whole voting round.
  it("rejects an empty reveal payload instead of yielding an invalid random", () => {
    expect(() => RevealData.decode("0x", feeds)).to.throw("missing 32-byte random");
  });

  it("rejects a short reveal that lacks the full 32-byte random", () => {
    expect(() => RevealData.decode("0x" + "ab".repeat(16), feeds)).to.throw("missing 32-byte random");
  });

  it("accepts a random-only reveal (empty feed values) as the minimal valid reveal", () => {
    const decoded = RevealData.decode(random, feeds);
    expect(decoded.random).to.equal(random);
    expect(decoded.valuesWithDecimals?.[0].isEmpty).to.equal(true);
  });

  it("round-trips a reveal with feed values through encode/decode", () => {
    const encodedValues = FeedValueEncoder.encode([1.23], feeds);
    const encoded = RevealData.encode({ random, feeds, encodedValues });
    const decoded = RevealData.decode(encoded, feeds);

    expect(decoded.random).to.equal(random);
    expect(decoded.encodedValues).to.equal(encodedValues);
    expect(decoded.valuesWithDecimals?.[0].value).to.equal(123);
  });

  it("yields a random that hashForCommit can hash as a uint256 (whereas the old '0x' random throws)", () => {
    const decoded = RevealData.decode(random, feeds);
    expect(() => CommitData.hashForCommit(voter, 1, decoded.random, decoded.encodedValues)).to.not.throw();
    // The previously-decodable empty reveal would have thrown here, halting the round.
    expect(() => CommitData.hashForCommit(voter, 1, "0x", "0x")).to.throw();
  });
});
