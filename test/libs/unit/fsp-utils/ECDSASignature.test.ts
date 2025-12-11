import { expect } from "chai";
import { readFileSync } from "fs";
import { ECDSASignature } from "../../../../libs/ftso-core/src/fsp-utils/ECDSASignature";

describe(`ECDSASignature`, () => {
  const accountPrivateKeys = JSON.parse(
    readFileSync("test/libs/unit/fsp-utils/data/test-1020-accounts.json", "utf8")
  ).map((x: { privateKey: string }) => x.privateKey);

  it("Should encode and decode ECDSA signature", () => {
    const messageHash = "0x1122334455667788990011223344556677889900112233445566778899001122";
    const signature = ECDSASignature.signMessageHash(messageHash, accountPrivateKeys[0]);
    const encoded = ECDSASignature.encode(signature);
    const decoded = ECDSASignature.decode(encoded);
    expect(decoded).to.deep.equal(signature);
  });
});
