// env NETWORK=coston yarn ts-node scripts/reward-finalizer-helper.ts stats <rewardEpochId>
import Web3 from "web3";
import { ECDSASignature } from "../libs/fsp-utils/src/ECDSASignature";
import { CONTRACTS, ZERO_BYTES32 } from "../libs/ftso-core/src/configs/networks";
import { FullVoterRegistrationInfo } from "../libs/ftso-core/src/events";
import { ABICache } from "../libs/ftso-core/src/utils/ABICache";
import { verifyWithMerkleProof } from "../libs/ftso-core/src/utils/MerkleTree";
import { RewardClaim } from "../libs/ftso-core/src/utils/RewardClaim";
import { deserializeRewardDistributionData } from "../libs/ftso-core/src/utils/stat-info/reward-distribution-data";
import { deserializeRewardEpochInfo } from "../libs/ftso-core/src/utils/stat-info/reward-epoch-info";
import { TestVoter } from "../test/utils/basic-generators";
import { claimSummary } from "../test/utils/reward-claim-summaries";

const COSTON_RPC = "https://coston-api.flare.network/ext/bc/C/rpc";
const abiCache = new ABICache();

const RPC = process.env.RPC || COSTON_RPC;
const web3 = new Web3(RPC);
console.log(`Connected to ${RPC}`);
const flareSystemsManager = new web3.eth.Contract(abiCache.contractNameToAbi.get(CONTRACTS.FlareSystemsManager.name), CONTRACTS.FlareSystemsManager.address);


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
   const wallet = web3.eth.accounts.privateKeyToAccount(signingPrivateKey);
   console.log(`Sending uptime vote for epoch ${rewardEpochId} from ${wallet.address}`);
   const fakeVoteHash = web3.utils.keccak256(ZERO_BYTES32);
   const message = "0x" + rewardEpochId.toString(16).padStart(64, "0") + fakeVoteHash.slice(2);
   const messageHash = web3.utils.keccak256(message);
   const signature = await ECDSASignature.signMessageHash(messageHash, signingPrivateKey);
   let gasPrice = await web3.eth.getGasPrice();
   const nonce = await web3.eth.getTransactionCount(wallet.address);
   gasPrice = gasPrice * 120n / 100n; // bump gas price by 20%
   let tx = {
      from: wallet.address,
      to: CONTRACTS.FlareSystemsManager.address,
      data: flareSystemsManager.methods.signUptimeVote(rewardEpochId, fakeVoteHash, signature).encodeABI(),
      value: "0",
      gas: "500000",
      gasPrice,
      nonce: Number(nonce).toString(),
   };
   const signed = await wallet.signTransaction(tx);
   const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
   console.log(`Uptime vote for epoch ${rewardEpochId} from ${wallet.address} sent`);
}

async function sendMerkleRoot(rewardEpochId: number, rewardsHash: string, noOfWeightBasedClaims: number, signingPrivateKey: string) {
   // bytes32 messageHash = keccak256(abi.encode(_rewardEpochId, _noOfWeightBasedClaims, _rewardsHash));
   const wallet = web3.eth.accounts.privateKeyToAccount(signingPrivateKey);
   console.log(`Sending merkle root for epoch ${rewardEpochId} from ${wallet.address}`);
   const message = "0x" + rewardEpochId.toString(16).padStart(64, "0") + noOfWeightBasedClaims.toString(16).padStart(64, "0") + rewardsHash.slice(2);
   const messageHash = web3.utils.keccak256(message);
   const signature = await ECDSASignature.signMessageHash(messageHash, signingPrivateKey);
   let gasPrice = await web3.eth.getGasPrice();
   const nonce = await web3.eth.getTransactionCount(wallet.address);
   gasPrice = gasPrice * 120n / 100n; // bump gas price by 20%
   let tx = {
      from: wallet.address,
      to: CONTRACTS.FlareSystemsManager.address,
      data: flareSystemsManager.methods.signRewards(rewardEpochId, noOfWeightBasedClaims, rewardsHash, signature).encodeABI(),
      gas: "500000",
      gasPrice,
      nonce: Number(nonce).toString(),
   };
   const signed = await wallet.signTransaction(tx);
   const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
   console.log(`Merkle root for epoch ${rewardEpochId} from ${wallet.address} sent`);
}

function fullVoterRegInfoToTestVoterPartial(regInfo: FullVoterRegistrationInfo): TestVoter {
   const result: TestVoter = {
      identityAddress: regInfo.voterRegistered.voter,
      signingAddress: regInfo.voterRegistered.signingPolicyAddress,
      signingPrivateKey: undefined,
      submitAddress: regInfo.voterRegistered.submitAddress,
      submitSignaturesAddress: regInfo.voterRegistered.submitSignaturesAddress,
      delegationAddress: regInfo.voterRegistrationInfo.delegationAddress,
      registrationWeight: undefined,
      wNatCappedWeight: undefined,
      // Unused
      wNatWeight: undefined,
      nodeIds: [],
      nodeWeights: [],
      delegationFeeBIPS: regInfo.voterRegistrationInfo.delegationFeeBIPS,
   }
   return result;
}

function getVotersData(rewardEpochId: number): TestVoter[] {
   const rewardEpochInfo = deserializeRewardEpochInfo(rewardEpochId);
   return rewardEpochInfo.voterRegistrationInfo.map(regInfo => fullVoterRegInfoToTestVoterPartial(regInfo));
}

function printClaimSummary(rewardEpochId: number) {
   const distributionData = deserializeRewardDistributionData(rewardEpochId);
   const mergedClaims = distributionData.rewardClaims.map((claim) => claim.body);
   const voters = getVotersData(rewardEpochId);
   claimSummary(voters, mergedClaims, console)
}

function verifyMerkleProofs(rewardEpochId: number) {
   const distributionData = deserializeRewardDistributionData(rewardEpochId);
   for (let claimWithProof of distributionData.rewardClaims) {
      const leaf = RewardClaim.hashRewardClaim(claimWithProof.body);
      const result = verifyWithMerkleProof(leaf, claimWithProof.merkleProof, distributionData.merkleRoot);
      if (!result) {
         console.error(`Merkle proof verification failed for claim ${claimWithProof}`);
         return false;
      }
   }
   return true;
}

async function sendUpTimeVotes(rewardEpochId: number) {
   if (!process.env.PRIVATE_KEYS) {
      throw new Error("PRIVATE_KEYS env variable is required. It should be a comma separated list of private keys, in hex, 0x-prefixed.");
   }
   const privateKeys = process.env.PRIVATE_KEYS?.split(",") || [];
   for (const privateKey of privateKeys) {
      await sendFakeUptimeVote(rewardEpochId, privateKey);
   }
}

async function sendMerkleProofs(rewardEpochId: number) {
   const distributionData = deserializeRewardDistributionData(rewardEpochId);
   if (!process.env.PRIVATE_KEYS) {
      throw new Error("PRIVATE_KEYS env variable is required. It should be a comma separated list of private keys, in hex, 0x-prefixed.");
   }
   const privateKeys = process.env.PRIVATE_KEYS?.split(",") || [];
   for (const privateKey of privateKeys) {
      await sendMerkleRoot(rewardEpochId, distributionData.merkleRoot, distributionData.noOfWeightBasedClaims, privateKey);
   }
}


export async function main() {
   const action = process.argv[2];
   if (!action) {
      throw new Error("Action is required");
   }
   if (action === "uptime") {
      const rewardEpochId = Number(process.argv[3]);
      if (!rewardEpochId) {
         throw new Error("usage: node reward-finalizer-helper.js uptime <rewardEpochId>");
      }
      await sendUpTimeVotes(rewardEpochId);
   }
   if (action === "stats") {
      const rewardEpochId = Number(process.argv[3]);
      if (!rewardEpochId) {
         throw new Error("usage: node reward-finalizer-helper.js stats <rewardEpochId>");
      }
      printClaimSummary(rewardEpochId);
      const check = verifyMerkleProofs(rewardEpochId);
      if(check) {
         console.log("Merkle proofs are valid");
      } else {
         console.error("Merkle proofs are invalid");
      }
   }
   if (action === "rewards") {
      const rewardEpochId = Number(process.argv[3]);
      if (rewardEpochId === undefined ) {
         throw new Error("usage: node reward-finalizer-helper.js rewards <rewardEpochId>");
      }
      await sendMerkleProofs(rewardEpochId);
   }
}

main().then(() => {
   console.dir("Done")
   process.exit(0);
}).catch((e) => {
   console.error(e);
   process.exit(1);
});