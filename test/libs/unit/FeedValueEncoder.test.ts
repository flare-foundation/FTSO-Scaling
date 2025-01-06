import { expect } from "chai";
import { FeedValueEncoder } from "../../../libs/ftso-core/src/data/FeedValueEncoder";
import { Feed } from "../../../libs/ftso-core/src/voting-types";

describe("FeedValueEncoder", () => {
  const feeds: Feed[] = [
    { id: "0000000000000000", decimals: 2 },
    { id: "0000000000000001", decimals: 3 },
  ];

  it("should encode and decode correctly", () => {
    const values: (number | undefined)[] = [1.23, 4.567];
    const encoded = FeedValueEncoder.encode(values, feeds);
    const decoded = FeedValueEncoder.decode(encoded, feeds);

    decoded.forEach((value, index) => {
      expect(value.value).to.equal(Math.round(values[index] * 10 ** feeds[index].decimals));
      expect(value.decimals).to.equal(feeds[index].decimals);
    });
  });

  it("should encode and decode correctly with undefined values - last", () => {
    const values: (number | undefined)[] = [1.23, undefined];
    const encoded = FeedValueEncoder.encode(values, feeds);
    const decoded = FeedValueEncoder.decode(encoded, feeds);

    expect(decoded[0].value).to.equal(Math.round(values[0] * 10 ** feeds[0].decimals));
    expect(decoded[0].decimals).to.equal(feeds[0].decimals);
    expect(decoded[1].isEmpty).to.equal(true);
  });

  it("should encode and decode correctly with undefined values - first", () => {
    const values: (number | undefined)[] = [undefined, 4.567];
    const encoded = FeedValueEncoder.encode(values, feeds);
    const decoded = FeedValueEncoder.decode(encoded, feeds);

    expect(decoded[0].isEmpty).to.equal(true);
    expect(decoded[1].value).to.equal(Math.round(values[1] * 10 ** feeds[1].decimals));
    expect(decoded[1].decimals).to.equal(feeds[1].decimals);
  });

  it("should encode and decode correctly with undefined values - all", () => {
    const values: (number | undefined)[] = [undefined, undefined];
    const encoded = FeedValueEncoder.encode(values, feeds);
    const decoded = FeedValueEncoder.decode(encoded, feeds);

    expect(decoded[0].isEmpty).to.equal(true);
    expect(decoded[1].isEmpty).to.equal(true);
  });
});
