/**
 * Returns truncated file path.
 * @param file module filename
 * @returns file path from `test/` on, separated by `'/'`
 */
export function getTestFile(myFile: string) {
  return myFile.slice(myFile.replace(/\\/g, '/').indexOf("test/"));
};

export const GOVERNANCE_GENESIS_ADDRESS = "0xfffEc6C83c8BF5c3F4AE0cCF8c45CE20E4560BD7";
export const STATE_CONNECTOR_ADDRESS = "0x1000000000000000000000000000000000000001";
export const FLARE_DAEMON_ADDRESS = "0x1000000000000000000000000000000000000002";
export const PRICE_SUBMITTER_ADDRESS = "0x1000000000000000000000000000000000000003";
export const GOVERNANCE_SETTINGS_ADDRESS = "0x183fAfF6997C98A812A3B98748Fc80241D08f312";

export const MIN_RANDOM = web3.utils.toBN(2).pow(web3.utils.toBN(128));

export const defaultPriceEpochCyclicBufferSize = 39;
export const ftsoRandomTestRuns = undefined;
