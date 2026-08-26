import { expect } from "chai";
import { CONTRACTS } from "../../../libs/contracts/src/constants";
import { CHAIN_ID } from "../../../libs/ftso-core/src/constants";
import { sourceChainIdForRelay } from "../../../libs/ftso-core/src/IndexerClient";
import { getTestFile } from "../../utils/getTestFile";

// Signatures in a finalization's calldata were made for the Relay it was sent to, so the digest follows
// the source. That is also what stops calldata for one Relay being replayed against the other: recovery
// fails and the submission is discarded, rather than counting toward grace-period rewards.
describe(`digest of a finalization's source relay (${getTestFile(__filename)})`, () => {
  it("binds the chain id only for Relay v2", () => {
    expect(sourceChainIdForRelay(CONTRACTS.RelayV2.address)).to.equal(CHAIN_ID());
    expect(sourceChainIdForRelay(CONTRACTS.RelayV2.address.toLowerCase())).to.equal(CHAIN_ID());
    expect(sourceChainIdForRelay(CONTRACTS.Relay.address)).to.be.undefined;
    expect(sourceChainIdForRelay("0x0000000000000000000000000000000000000001")).to.be.undefined;
  });
});
