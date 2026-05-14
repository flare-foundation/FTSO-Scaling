import { expect } from "chai";
import { FeedValueEncoder } from "../../../libs/ftso-core/src/data/FeedValueEncoder";
import { Feed } from "../../../libs/ftso-core/src/voting-types";
import { getTestFile } from "../../utils/getTestFile";

describe(`FeedValueEncoder (${getTestFile(__filename)})`, () => {
  const feeds: Feed[] = [
    { id: "0000000000000000", decimals: 2 },
    { id: "0000000000000001", decimals: 3 },
  ];

  it("roundtrips defined feed values through encode/decode with correct decimal scaling", () => {
    const values: (number | undefined)[] = [1.23, 4.567];
    const encoded = FeedValueEncoder.encode(values, feeds);
    const decoded = FeedValueEncoder.decode(encoded, feeds);

    decoded.forEach((value, index) => {
      expect(value.value).to.equal(Math.round(values[index] * 10 ** feeds[index].decimals));
      expect(value.decimals).to.equal(feeds[index].decimals);
    });
  });

  it("encodes a trailing undefined value as an empty feed slot", () => {
    const values: (number | undefined)[] = [1.23, undefined];
    const encoded = FeedValueEncoder.encode(values, feeds);
    const decoded = FeedValueEncoder.decode(encoded, feeds);

    expect(decoded[0].value).to.equal(Math.round(values[0] * 10 ** feeds[0].decimals));
    expect(decoded[0].decimals).to.equal(feeds[0].decimals);
    expect(decoded[1].isEmpty).to.equal(true);
  });

  it("encodes a leading undefined value as an empty feed slot", () => {
    const values: (number | undefined)[] = [undefined, 4.567];
    const encoded = FeedValueEncoder.encode(values, feeds);
    const decoded = FeedValueEncoder.decode(encoded, feeds);

    expect(decoded[0].isEmpty).to.equal(true);
    expect(decoded[1].value).to.equal(Math.round(values[1] * 10 ** feeds[1].decimals));
    expect(decoded[1].decimals).to.equal(feeds[1].decimals);
  });

  it("encodes all-undefined values as all empty feed slots", () => {
    const values: (number | undefined)[] = [undefined, undefined];
    const encoded = FeedValueEncoder.encode(values, feeds);
    const decoded = FeedValueEncoder.decode(encoded, feeds);

    expect(decoded[0].isEmpty).to.equal(true);
    expect(decoded[1].isEmpty).to.equal(true);
  });

  it("rejects decode when packed values contain more entries than feeds", () => {
    const encoded = "0x000000000000000000000000";
    expect(() => FeedValueEncoder.decode(encoded, feeds)).to.throw("Invalid feed values count: 3; expected at most 2");
  });

  it("should reject non-finite values before encoding", () => {
    expect(() => FeedValueEncoder.encode([NaN, 1], feeds)).to.throw("is not a finite number");
    expect(() => FeedValueEncoder.encode([Infinity, 1], feeds)).to.throw("is not a finite number");
  });

  it("should reject runtime non-number values before encoding", () => {
    expect(() => FeedValueEncoder.encode([null as any, 1], feeds)).to.throw("is not a finite number");
    expect(() => FeedValueEncoder.encode(["1" as any, 1], feeds)).to.throw("is not a finite number");
  });

  it("should reject invalid feed decimals before encoding", () => {
    expect(() => FeedValueEncoder.encode([1], [{ id: "0000000000000000", decimals: -1 }])).to.throw(
      "Invalid decimals"
    );
    expect(() => FeedValueEncoder.encode([1], [{ id: "0000000000000000", decimals: 1.5 }])).to.throw(
      "Invalid decimals"
    );
  });

  it("should treat empty packed values as all feeds empty", () => {
    const decoded = FeedValueEncoder.decode("0x", feeds);
    expect(decoded.length).to.equal(feeds.length);
    decoded.forEach((value, index) => {
      expect(value.isEmpty).to.equal(true);
      expect(value.value).to.equal(0);
      expect(value.decimals).to.equal(feeds[index].decimals);
    });
  });
});
