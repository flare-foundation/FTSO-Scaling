import { expect } from "chai";
import { readFileSync } from "fs";
import { ECDSASignatureWithIndex } from "../../../../libs/fsp-utils/src/ECDSASignatureWithIndex";

describe(`ECDSASignatureWithIndex`, async () => {
  const accountPrivateKeys = JSON.parse(
    readFileSync("test/libs/unit/fsp-utils/data/test-1020-accounts.json", "utf8")
  ).map((x: any) => x.privateKey);

  it("Should encode and decode ECDSA signature with index", async () => {
    const messageHash = "0x1122334455667788990011223344556677889900112233445566778899001122";
    const signature = await ECDSASignatureWithIndex.signMessageHash(messageHash, accountPrivateKeys[0], 0);
    const encoded = ECDSASignatureWithIndex.encode(signature);
    const decoded = ECDSASignatureWithIndex.decode(encoded);
    expect(decoded).to.deep.equal(signature);
  });
});
