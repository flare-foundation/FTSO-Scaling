import { VotingManagerInstance } from "../../../typechain-truffle";
import { increaseTimeTo, toBN } from "../../utils/test-helpers";
import { ClaimReward } from "./voting-interfaces";


// /**
//  * 
//  * @param voter Returns the hash for a commit operation.
//  * @param random 
//  * @param merkleRoot 
//  * @param prices 
//  * @returns 
//  */
// export function hashForCommit(voter: string, random: string, merkleRoot: string, prices: string) {
//   const types = [
//     "address",
//     "uint256",
//     "bytes32",
//     "bytes"
//   ];
//   const values = [
//     voter,
//     random,
//     merkleRoot,
//     prices
//   ] as any[];
//   const encoded = web3.eth.abi.encodeParameters(types, values);

//   return web3.utils.soliditySha3(encoded)!;
// }


/**
 * Moves time to the start of the next epoch.
 * If firstRewardedPriceEpoch and REWARD_EPOCH_DURATION are provided, it will move time to the start of the next reward epoch
 * @param votingManager 
 * @param firstRewardedPriceEpoch 
 * @param REWARD_EPOCH_DURATION 
 */
export async function moveToNextEpochStart(votingManager: VotingManagerInstance, firstRewardedPriceEpoch?: BN, REWARD_EPOCH_DURATION?: number) {
  let firstEpochStartSec = await votingManager.BUFFER_TIMESTAMP_OFFSET();
  let epochDurationSec = await votingManager.BUFFER_WINDOW();
  
  let time;
  if(firstRewardedPriceEpoch && REWARD_EPOCH_DURATION) {
    let currentRewardEpochId = await votingManager.getCurrentRewardEpochId();
    time = firstEpochStartSec.add(
      epochDurationSec.mul(
        firstRewardedPriceEpoch.add(
          toBN(REWARD_EPOCH_DURATION).mul(currentRewardEpochId.add(toBN(1)))
        )
      )
    ).toNumber()

  } else {
    let currentEpoch = await votingManager.getCurrentEpochId();
    time = firstEpochStartSec.add(
      epochDurationSec.mul(
        currentEpoch.add(
          toBN(1)
        )
      )
    ).toNumber()
  }
  await increaseTimeTo(time);
}

/**
 * A sorted hash of two 32-byte strings
 * @param x first `0x`-prefixed 32-byte hex string
 * @param y second `0x`-prefixed 32-byte hex string
 * @returns the sorted hash
 */
export function sortedHashPair(x: string, y: string) {
  if (x <= y) {
    return web3.utils.soliditySha3(web3.eth.abi.encodeParameters(["bytes32", "bytes32"], [x, y]));
  }
  return web3.utils.soliditySha3(web3.eth.abi.encodeParameters(["bytes32", "bytes32"], [y, x]));
}
export function hashClaimReward(data: ClaimReward, salt?: string) {
  const types = [
    "string", // "voter_aggregate"
    "uint256", // chainId
    "uint256", // epochId
    "address", // voterAddress
    "uint256", //amount
  ];
  const values = [
    "voter_aggregate",
    data.chainId,
    data.epochId,
    data.voterAddress,
    data.amount
  ] as any[];
  if (salt) {
    types.push("string");
    values.push(salt);
  }
  const encoded = web3.eth.abi.encodeParameters(types, values);

  return web3.utils.soliditySha3(encoded)!;
}