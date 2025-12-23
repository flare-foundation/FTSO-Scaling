import { expect } from "chai";
import { readFileSync } from "fs";
import { ECDSASignatureWithIndex } from "../../../../libs/ftso-core/src/fsp-utils/ECDSASignatureWithIndex";

describe(`ECDSASignatureWithIndex`, () => {
  const accountPrivateKeys = JSON.parse(
    readFileSync("test/libs/unit/fsp-utils/data/test-1020-accounts.json", "utf8")
  ).map((x: { privateKey: string }) => x.privateKey);

  it("Should encode and decode ECDSA signature with index", async () => {
    const messageHash = "0x1122334455667788990011223344556677889900112233445566778899001122";
    const signature = ECDSASignatureWithIndex.signMessageHash(messageHash, accountPrivateKeys[0], 0);
    const encoded = ECDSASignatureWithIndex.encode(signature);
    const decoded = ECDSASignatureWithIndex.decode(encoded);
    expect(decoded).to.deep.equal(signature);
  });
});
