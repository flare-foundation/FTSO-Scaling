// env NETWORK=flare yarn ts-node scripts/analytics/run/min-condition-check.ts 265
// env NETWORK=songbird yarn ts-node scripts/analytics/run/min-condition-check.ts 265

import { BURN_ADDRESS } from "../../../libs/fsp-rewards/src/constants";
import { buildRewardClaimMerkleTree } from "../../../libs/fsp-rewards/src/reward-calculation/reward-merkle-tree";
import { IRewardClaimWithProof } from "../../../libs/fsp-rewards/src/utils/RewardClaim";
import { deserializeRewardDistributionData } from "../../../libs/fsp-rewards/src/utils/stat-info/reward-distribution-data";

function key(claim: IRewardClaimWithProof) {
  return `${claim.body.beneficiary.toLowerCase()}-${claim.body.claimType}`;
}

function assembleMap(claims: IRewardClaimWithProof[]) {
  const map = new Map<string, IRewardClaimWithProof>();
  for (const claim of claims) {
    const k = key(claim);
    if (map.has(k)) {
      throw new Error(`Duplicate key ${k}`);
    }
    map.set(k, claim);
  }
  return map;
}

function testSubsetKeys(map: Map<string, IRewardClaimWithProof>, subset: Map<string, IRewardClaimWithProof>) {
  let burnDifference = 0n;
  for (const [k, v] of subset.entries()) {
    if (!map.has(k)) {
      throw new Error(`Key ${k} not found`);
    }
    const subsetAmount = BigInt(v.body.amount);
    const mapAmount = BigInt(map.get(k)!.body.amount);
    if (subsetAmount !== mapAmount) {
      if (v.body.beneficiary.toLowerCase() === BURN_ADDRESS.toLowerCase()) {
        burnDifference = subsetAmount - mapAmount;
        console.log("Additional burn:", burnDifference, Number(burnDifference) / 1e18);
      } else {
        throw new Error(`Amount mismatch for ${k}: ${subsetAmount} !== ${mapAmount}`);
      }
    }
  }
  return burnDifference;
}

function missingClaims(map: Map<string, IRewardClaimWithProof>, subset: Map<string, IRewardClaimWithProof>) {
  let totalAmount = 0n;
  let missingClaimCount = 0;
  for (const [k, v] of map.entries()) {
    if (!subset.has(k)) {
      const amount = BigInt(v.body.amount);
      console.log(`${v.body.beneficiary} ${v.body.claimType} ${v.body.amount} ${Number(amount) / 1e18}`);
      totalAmount += amount;
      missingClaimCount++;
    }
  }
  console.log("-------------------");
  console.log("Total missing claims:", missingClaimCount);
  console.log("Total missing amount:", totalAmount, Number(totalAmount) / 1e18);
  return totalAmount;
}

function numberOfWeightBasedClaims(claims: IRewardClaimWithProof[]) {
  return claims.filter(c => c.body.claimType >= 2).length;
}

async function main() {
  if (!process.argv[2]) {
    throw new Error("no rewardEpochId");
  }

  const rewardEpochId = parseInt(process.argv[2]);
  const network = process.argv[3];
  if (!process.env.NETWORK) {
    throw new Error("NETWORK not set");
  }
  console.log("Network:", process.env.NETWORK);

  const distributionData = deserializeRewardDistributionData(rewardEpochId, false);
  const distributionDataMinConditions = deserializeRewardDistributionData(rewardEpochId, true);
  const merkleTree = buildRewardClaimMerkleTree(distributionData.rewardClaims.map(c => c.body));
  const merkleTreeMinConditions = buildRewardClaimMerkleTree(distributionDataMinConditions.rewardClaims.map(c => c.body));

  const rewardClaimsMap = assembleMap(distributionData.rewardClaims);
  const rewardClaimsMinConditionsMap = assembleMap(distributionDataMinConditions.rewardClaims);

  const burnDifference = testSubsetKeys(rewardClaimsMap, rewardClaimsMinConditionsMap);
  console.log("All claims from minimal conditions present");

  console.log("---------------Original ---------------------");
  console.log("Reward distribution data:");
  console.log("Merkle root: ", distributionData.merkleRoot, distributionData.merkleRoot === merkleTree.root);
  console.log("No. of weight based claims: ", distributionData.noOfWeightBasedClaims, distributionData.noOfWeightBasedClaims === numberOfWeightBasedClaims(distributionData.rewardClaims));
  console.log("Claims:", distributionData.rewardClaims.length);

  console.log("---------------Min Conditions ---------------------");
  console.log("Reward distribution data:");
  console.log("Merkle root: ", distributionDataMinConditions.merkleRoot, distributionDataMinConditions.merkleRoot === merkleTreeMinConditions.root);
  console.log("No. of weight based claims: ", distributionDataMinConditions.noOfWeightBasedClaims, distributionDataMinConditions.noOfWeightBasedClaims === numberOfWeightBasedClaims(distributionDataMinConditions.rewardClaims));
  console.log("Claims:", distributionDataMinConditions.rewardClaims.length);
  console.log("Missing claims:");
  const missingClaimsAmount = missingClaims(rewardClaimsMap, rewardClaimsMinConditionsMap);
  if (missingClaimsAmount !== burnDifference) {
    throw new Error("Burn difference does not match missing claims");
  }
  console.log("OK");
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
