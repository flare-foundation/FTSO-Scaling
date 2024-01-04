import Web3 from "web3";

import { getTestFile } from "../../test-utils/constants";
import { getWeb3, signMessage, recoverSigner } from "../../apps/ftso-calculator/src/utils/web3";
import { BareSignature } from "../../libs/ftso-core/src/voting-types";

const rpcLink = "http://localhost:8545";

describe(`web3-utils; ${getTestFile(__filename)}`, () => {
  let web3: Web3;

  beforeEach(() => {
    web3 = getWeb3(rpcLink);
  });

  it("should sign message and recover correct signer", () => {
    const account = web3.eth.accounts.create();
    const message = "Hello, world!";
    const privateKey = account.privateKey;

    const signature: BareSignature = signMessage(web3, message, privateKey);
    const signer: string = recoverSigner(web3, message, signature);

    expect(signer).to.equal(account.address.toLowerCase());
  });
});
