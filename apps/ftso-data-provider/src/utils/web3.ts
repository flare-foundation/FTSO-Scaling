import Web3 from "web3";
import { BareSignature } from "../../../../libs/ftso-core/src/voting-types";

/**
 * Returns the address (lowercase) which generated the {@link signature} for the provided {@link message}.
 *
 * Note that an invalid signature, or a signature from a different message, will still result in some public
 * key (address) being recovered. To ensure the signature is correct this will need to be compared to the expected signer.
 */
export function recoverSigner(web3: Web3, message: string, signature: BareSignature): string {
  return web3.eth.accounts.recover(message, "0x" + signature.v.toString(16), signature.r, signature.s).toLowerCase();
}
