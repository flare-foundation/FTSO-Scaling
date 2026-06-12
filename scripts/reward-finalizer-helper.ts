/* eslint-disable no-inner-declarations */
/*
# Usage

The tool bases on calculated data in the `calculations` folder. These can be calculated using the script

./scripts/rewards/coston-db.sh

For calculation of specific reward epoch set the parameters in the call in the script accordingly.
Once the relevant reward epoch data are calculated, the tool can be used to:
- check some reward distribution stats (option `stats`).

      env NETWORK=coston pnpm ts-node scripts/reward-finalizer-helper.ts stats <rewardEpochId>

- voting for uptime using dummy hash (vote for it). This option is currently used as real uptime voting is not enabled, but it will be in the future and 
  it is needed as pre-condition for reward merkle root voting. (option `uptime`)

      env NETWORK=coston pnpm ts-node scripts/reward-finalizer-helper.ts uptime <rewardEpochId> [endRewardEpochId]

- voting for reward merkle root. (option `rewards`). The data is extracted from the calculation result in the file
  `calculations/<reward epoch id>/reward-distribution-data.json`.

      env NETWORK=coston pnpm ts-node scripts/reward-finalizer-helper.ts rewards <rewardEpochId> [endRewardEpochId]

- check the finalization status of the reward epochs. (option `finalizations`)
      env NETWORK=coston pnpm ts-node scripts/reward-finalizer-helper.ts finalizations <startRewardEpochId> [endRewardEpochId]

- initialize weight based claims. (option `winit`)
      env NETWORK=coston pnpm ts-node scripts/reward-finalizer-helper.ts winit <rewardEpochId> [batchSize] [offset] [noBatches]

- check the number of uninitialized weight based claims. (option `uninitialized`)
      env NETWORK=coston pnpm ts-node scripts/reward-finalizer-helper.ts uninitialized <rewardEpochId>

Note the actions `uptime` and `rewards` need private key(s) since they are signing some data an sending to smart contracts on
`Coston` blockchain. For that purpose, pack the private keys (comma separate, no spaces) into variable env variable 
`PRIVATE_KEYS` and export it in terminal shell in which you are running a specific command.

e.g. `export PRIVATE_KEYS=0x...1,0x...2,0x...3`

Private keys must be in hex string, 0x-prefixed.
Also, option `winit` needs one private key, which is taken as the first private key in the PRIVATE_KEYS env variable.
*/
import * as dotenv from "dotenv";
import { readFileSync } from "fs";
import { AbiCoder, Contract, JsonRpcProvider, keccak256, Wallet } from "ethers";
import { CONTRACTS } from "../libs/contracts/src/constants";
import { ZERO_BYTES32 } from "../libs/fsp-rewards/src/constants";
import { ClaimType, IRewardClaimWithProof } from "../libs/fsp-rewards/src/utils/RewardClaim";
import { deserializeRewardDistributionData } from "../libs/fsp-rewards/src/utils/stat-info/reward-distribution-data";
import { ECDSASignature } from "../libs/ftso-core/src/fsp-utils/ECDSASignature";
import { printClaimSummary, verifyMerkleProofs } from "./stats-utils";

dotenv.config();

const COSTON_RPC = "https://coston-api.flare.network/ext/bc/C/rpc";

const RPC = process.env.RPC || COSTON_RPC;
const provider = new JsonRpcProvider(RPC);
console.log(`Connected to ${RPC}`);

const flareSystemsManagerAbi = JSON.parse(readFileSync(`abi/FlareSystemsManager.json`).toString()).abi;
const rewardManagerAbi = JSON.parse(readFileSync(`abi/RewardManager.json`).toString()).abi;
const relayAbi = JSON.parse(readFileSync(`abi/Relay.json`).toString()).abi;
const flareSystemsManager = new Contract(CONTRACTS.FlareSystemsManager.address, flareSystemsManagerAbi, provider);
const rewardManager = new Contract(CONTRACTS.RewardManager.address, rewardManagerAbi, provider);
const relay = new Contract(CONTRACTS.Relay.address, relayAbi, provider);
const coder = AbiCoder.defaultAbiCoder();

/**
 * Bumps the network gas price by 20%.
 */
async function bumpedGasPrice(): Promise<bigint> {
  const feeData = await provider.getFeeData();
  if (feeData.gasPrice === null) throw new Error("Could not fetch gas price from RPC");
  return (feeData.gasPrice * 120n) / 100n;
}

// struct Signature {
//    uint8 v;
//    bytes32 r;
//    bytes32 s;
// }

// function signRewards(
//    uint24 _rewardEpochId,
//    uint64 _noOfWeightBasedClaims,
//    bytes32 _rewardsHash,
//    Signature calldata _signature
// )

// function signUptimeVote(
//    uint24 _rewardEpochId,
//    bytes32 _uptimeVoteHash,
//    Signature calldata _signature
// )

async function sendFakeUptimeVote(rewardEpochId: number, signingPrivateKey: string) {
  // bytes32 messageHash = keccak256(abi.encode(_rewardEpochId, _uptimeVoteHash));
  const wallet = new Wallet(signingPrivateKey, provider);
  console.log(`Sending uptime vote for epoch ${rewardEpochId} from ${wallet.address}`);
  const fakeVoteHash = keccak256(ZERO_BYTES32);
  const message = "0x" + rewardEpochId.toString(16).padStart(64, "0") + fakeVoteHash.slice(2);
  const messageHash = keccak256(message);
  const signature = await ECDSASignature.signMessageHash(messageHash, signingPrivateKey);
  const gasPrice = await bumpedGasPrice();
  const nonce = await provider.getTransactionCount(wallet.address);
  const tx = await wallet.sendTransaction({
    to: CONTRACTS.FlareSystemsManager.address,
    data: flareSystemsManager.interface.encodeFunctionData("signUptimeVote", [rewardEpochId, fakeVoteHash, signature]),
    value: 0,
    gasLimit: 500000n,
    gasPrice,
    nonce,
  });
  await tx.wait();
  console.log(`Uptime vote for epoch ${rewardEpochId} from ${wallet.address} sent`);
}

async function sendNewSigningPolicy(rewardEpochId: number, signingPrivateKey: string) {
  const wallet = new Wallet(signingPrivateKey, provider);
  console.log(`Sending signing policy vote for epoch ${rewardEpochId} from ${wallet.address}`);
  const signingPolicyHash: string = await relay.toSigningPolicyHash(rewardEpochId);
  const signature = await ECDSASignature.signMessageHash(signingPolicyHash, signingPrivateKey);
  const gasPrice = await bumpedGasPrice();
  const nonce = await provider.getTransactionCount(wallet.address);
  const tx = await wallet.sendTransaction({
    to: CONTRACTS.FlareSystemsManager.address,
    data: flareSystemsManager.interface.encodeFunctionData("signNewSigningPolicy", [
      rewardEpochId,
      signingPolicyHash,
      signature,
    ]),
    value: 0,
    gasLimit: 500000n,
    gasPrice,
    nonce,
  });
  await tx.wait();
  console.log(`New signing policy vote for epoch ${rewardEpochId} from ${wallet.address} sent`);
}

async function sendMerkleRoot(
  rewardEpochId: number,
  rewardsHash: string,
  noOfWeightBasedClaims: number,
  signingPrivateKey: string
) {
  // bytes32 messageHash = keccak256(abi.encode(_rewardEpochId, _noOfWeightBasedClaims, _rewardsHash));
  const wallet = new Wallet(signingPrivateKey, provider);
  console.log(`Sending merkle root for epoch ${rewardEpochId} from ${wallet.address}`);
  const rewardManagerId = (await provider.getNetwork()).chainId;
  const noOfWeightBasedClaimsAndId = [[rewardManagerId, noOfWeightBasedClaims]];
  const noOfWeightBasedClaimsEncoded = coder.encode(["tuple(uint256,uint256)[]"], [noOfWeightBasedClaimsAndId]);
  // const noOfWeightBasedClaimsEncoded1 =
  //   "0x" +
  //   "0000000000000000000000000000000000000000000000000000000000000020" +
  //   "0000000000000000000000000000000000000000000000000000000000000001" +
  //   rewardManagerId.toString(16).padStart(64, "0") +
  //   noOfWeightBasedClaims.toString(16).padStart(64, "0");

  const noOfWeightBasedClaimsHash = keccak256(noOfWeightBasedClaimsEncoded);
  const message =
    "0x" +
    rewardEpochId.toString(16).padStart(64, "0") +
    noOfWeightBasedClaimsHash.slice(2) +
    rewardsHash.slice(2);
  const messageHash = keccak256(message);
  const signature = await ECDSASignature.signMessageHash(messageHash, signingPrivateKey);
  const gasPrice = await bumpedGasPrice();
  const nonce = await provider.getTransactionCount(wallet.address);
  const tx = await wallet.sendTransaction({
    to: CONTRACTS.FlareSystemsManager.address,
    data: flareSystemsManager.interface.encodeFunctionData("signRewards", [
      rewardEpochId,
      noOfWeightBasedClaimsAndId,
      rewardsHash,
      signature,
    ]),
    gasLimit: 500000n,
    gasPrice,
    nonce,
  });
  await tx.wait();
  console.log(`Merkle root for epoch ${rewardEpochId} from ${wallet.address} sent`);
}

async function sendUpTimeVotes(rewardEpochId: number) {
  if (!process.env.PRIVATE_KEYS) {
    throw new Error(
      "PRIVATE_KEYS env variable is required. It should be a comma separated list of private keys, in hex, 0x-prefixed."
    );
  }
  const privateKeys = process.env.PRIVATE_KEYS?.split(",") || [];
  for (const privateKey of privateKeys) {
    try {
      await sendFakeUptimeVote(rewardEpochId, privateKey);
    } catch (e) {
      const wallet = new Wallet(privateKey);
      console.error(`Error sending uptime vote for epoch ${rewardEpochId} from ${wallet.address}: ${e}`);
      console.dir(e);
      break;
    }
  }
}

async function sendNewSigningPolicyVotes(rewardEpochId: number) {
  if (!process.env.PRIVATE_KEYS) {
    throw new Error(
      "PRIVATE_KEYS env variable is required. It should be a comma separated list of private keys, in hex, 0x-prefixed."
    );
  }
  const privateKeys = process.env.PRIVATE_KEYS?.split(",") || [];
  for (const privateKey of privateKeys) {
    try {
      await sendNewSigningPolicy(rewardEpochId, privateKey);
    } catch (e) {
      const wallet = new Wallet(privateKey);
      console.error(`Error sending new signing policy vote for epoch ${rewardEpochId} from ${wallet.address}: ${e}`);
      console.dir(e);
      break;
    }
  }
}

async function sendMerkleProofs(rewardEpochId: number) {
  const distributionData = deserializeRewardDistributionData(rewardEpochId);
  if (!process.env.PRIVATE_KEYS) {
    throw new Error(
      "PRIVATE_KEYS env variable is required. It should be a comma separated list of private keys, in hex, 0x-prefixed."
    );
  }
  const privateKeys = process.env.PRIVATE_KEYS?.split(",") || [];
  for (const privateKey of privateKeys) {
    try {
      await sendMerkleRoot(
        rewardEpochId,
        distributionData.merkleRoot,
        distributionData.noOfWeightBasedClaims,
        privateKey
      );
    } catch (e) {
      const wallet = new Wallet(privateKey);
      console.error(`Error sending merkle root for epoch ${rewardEpochId} from ${wallet.address}: ${e}`);
      console.dir(e);
      break;
    }
  }
}

async function checkTotalRewardDataFromContract(rewardEpochId: number) {
  const totals = await rewardManager.getRewardEpochTotals(rewardEpochId);
  const contractTotal = (totals as any)._totalRewardsWei;
  const distributionData = deserializeRewardDistributionData(rewardEpochId);
  let claimedTotal = 0n;
  for(const claim of distributionData.rewardClaims) {
    claimedTotal += claim.body.amount;
  }
  if(contractTotal !== claimedTotal) {
    console.error(`Total rewards mismatch: ${contractTotal} vs ${claimedTotal}`);
    return false;
  } else {
    console.log(`Total rewards match: ${contractTotal}`);
    return true;
  }
}

export async function main() {
  const action = process.argv[2];
  if (!action) {
    throw new Error("Action is required");
  }
  if (action === "signingPolicy") {
    if (!process.argv[3]) {
      throw new Error("usage: node reward-finalizer-helper.js signing policy <rewardEpochId> [endRewardEpochId]");
    }
    const rewardEpochId = Number(process.argv[3]);
    let endRewardEpochId = rewardEpochId;
    if (process.argv[4]) {
      endRewardEpochId = Number(process.argv[4]);
    }
    for (let currentRewardEpochId = rewardEpochId; currentRewardEpochId <= endRewardEpochId; currentRewardEpochId++) {
      await sendNewSigningPolicyVotes(currentRewardEpochId);
    }
  }
  if (action === "uptime") {
    if (!process.argv[3]) {
      throw new Error("usage: node reward-finalizer-helper.js uptime <rewardEpochId> [endRewardEpochId]");
    }
    const rewardEpochId = Number(process.argv[3]);
    let endRewardEpochId = rewardEpochId;
    if (process.argv[4]) {
      endRewardEpochId = Number(process.argv[4]);
    }
    for (let currentRewardEpochId = rewardEpochId; currentRewardEpochId <= endRewardEpochId; currentRewardEpochId++) {
      await sendUpTimeVotes(currentRewardEpochId);
    }
  }
  if (action === "stats") {
    if (!process.argv[3]) {
      throw new Error("usage: node reward-finalizer-helper.js stats <rewardEpochId>");
    }
    const rewardEpochId = Number(process.argv[3]);
    printClaimSummary(rewardEpochId);
    const check = verifyMerkleProofs(rewardEpochId);
    if (check) {
      console.log("Merkle proofs are valid");
    } else {
      console.error("Merkle proofs are invalid");
    }
    if(process.env.RPC) {
      await checkTotalRewardDataFromContract(rewardEpochId);        
    } else {
      console.error("RPC is not set. Skipping check for totals from RewardManager contract.");
    }
  }
  if (action === "rewards") {
    if (!process.argv[3]) {
      throw new Error("usage: node reward-finalizer-helper.js rewards <rewardEpochId> [endRewardEpochId]");
    }
    const rewardEpochId = Number(process.argv[3]);

    let endRewardEpochId = rewardEpochId;
    if (process.argv[4]) {
      endRewardEpochId = Number(process.argv[4]);
    }
    for (let currentRewardEpochId = rewardEpochId; currentRewardEpochId <= endRewardEpochId; currentRewardEpochId++) {
      try {
        await sendMerkleProofs(currentRewardEpochId);
      } catch (e) {
        console.error(`Error sending merkle proofs for epoch ${currentRewardEpochId}: ${e}`);
      }
    }
  }

  if (action === "finalizations") {
    if (!process.argv[3]) {
      throw new Error("usage: node reward-finalizer-helper.js finalizations <rewardEpochId> [endRewardEpochId]");
    }
    const startRewardEpochId = Number(process.argv[3]);
    let endRewardEpochId = startRewardEpochId;
    if (process.argv[4]) {
      endRewardEpochId = Number(process.argv[4]);
    }
    console.log(`Rw.ep.id | Uptime | Rewards`);
    for (
      let currentRewardEpochId = startRewardEpochId;
      currentRewardEpochId <= endRewardEpochId;
      currentRewardEpochId++
    ) {
      const uptimeVoteHash = await flareSystemsManager.uptimeVoteHash(currentRewardEpochId);
      const rewardsHash = await flareSystemsManager.rewardsHash(currentRewardEpochId);
      const isUptimeHash = uptimeVoteHash && (uptimeVoteHash as any as string) !== ZERO_BYTES32;
      const isRewardsHash = rewardsHash && (rewardsHash as any as string) !== ZERO_BYTES32;
      console.log(
        `${currentRewardEpochId.toString().padEnd(10)} ${(isUptimeHash ? " OK " : " - ").padEnd(9)} ${(isRewardsHash
          ? "OK "
          : " - "
        ).padEnd(9)}`
      );
    }
  }
  if (action === "winit") {
    if (!process.argv[3]) {
      throw new Error("usage: node reward-finalizer-helper.js winit <rewardEpochId> [batchSize] [offset] [noBatches]");
    }
    const rewardEpochId = Number(process.argv[3]);
    let batchSize = 10;
    if (process.argv[4]) {
      batchSize = Number(process.argv[4]);
    }
    let offset = 0;
    if (process.argv[5]) {
      offset = Number(process.argv[5]);
    }
    let numBatches: number | undefined;
    if (process.argv[6]) {
      numBatches = Number(process.argv[6]);
    }
    const distributionData = deserializeRewardDistributionData(rewardEpochId);
    if (!process.env.PRIVATE_KEYS) {
      throw new Error(
        "PRIVATE_KEYS env variable is required. It should be a comma separated list of private keys, in hex, 0x-prefixed."
      );
    }
    const privateKeys = process.env.PRIVATE_KEYS?.split(",") || [];
    if (privateKeys.length === 0) {
      throw new Error("No private keys found in PRIVATE_KEYS env variable");
    }
    const wallet = new Wallet(privateKeys[0], provider);

    async function sendBatch(batch: IRewardClaimWithProof[]) {
      const data = rewardManager.interface.encodeFunctionData("initialiseWeightBasedClaims", [batch]);
      const gasPrice = await bumpedGasPrice();
      const nonce = await provider.getTransactionCount(wallet.address);
      const tx = await wallet.sendTransaction({
        to: CONTRACTS.RewardManager.address,
        data,
        value: 0,
        gasLimit: 2000000n,
        gasPrice,
        nonce,
      });
      await tx.wait();
    }

    const weightBasedClaims = distributionData.rewardClaims.filter(
      claimWithProof =>
        claimWithProof.body.claimType === ClaimType.WNAT ||
        claimWithProof.body.claimType === ClaimType.MIRROR ||
        claimWithProof.body.claimType === ClaimType.CCHAIN
    );
    console.log(`Total weight based claims: ${weightBasedClaims.length}`);
    for (
      let start = offset, numberOfBatches = 0;
      start < weightBasedClaims.length;
      start += batchSize, numberOfBatches++
    ) {
      if (numBatches !== undefined && numberOfBatches >= numBatches) {
        break;
      }
      const batch = weightBasedClaims.slice(start, start + batchSize);
      try {
        await sendBatch(batch);
      } catch (e) {
        console.log(`Batch ${start} to ${start + batchSize} failed`);
        console.error(`Error sending merkle proofs for epoch ${rewardEpochId}: ${e}`);
        console.dir(e);
      }
    }
    rewardManager;
  }

  if (action === "uninitialized") {
    if (!process.argv[3]) {
      throw new Error("usage: node reward-finalizer-helper.js uninitialized <rewardEpochId>");
    }
    const rewardEpochId = Number(process.argv[3]);
    const distributionData = deserializeRewardDistributionData(rewardEpochId);
    const weightBasedClaims = distributionData.rewardClaims.filter(
      claimWithProof =>
        claimWithProof.body.claimType === ClaimType.WNAT ||
        claimWithProof.body.claimType === ClaimType.MIRROR ||
        claimWithProof.body.claimType === ClaimType.CCHAIN
    );
    let uninitializedCount = 0;
    for (const claimWithProof of weightBasedClaims) {
      const claim = claimWithProof.body;
      const state = (await rewardManager.getUnclaimedRewardState(
        claim.beneficiary,
        claim.rewardEpochId,
        claim.claimType
      )) as any;
      if (!state.initialised) {
        uninitializedCount++;
        console.dir(claim);
      }
    }
    console.log(`Total weight based claims: ${weightBasedClaims.length}, Uninitialized: ${uninitializedCount}`);
  }
}

main()
  .then(() => {
    console.dir("Done");
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
