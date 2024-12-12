import path from "path/posix";
import { deserializeGranulatedPartialOfferMap, deserializeGranulatedPartialOfferMapForFastUpdates, deserializeOffersForFDC } from "../../../libs/ftso-core/src/utils/stat-info/granulated-partial-offers-map";
import { deserializeRewardEpochInfo } from "../../../libs/ftso-core/src/utils/stat-info/reward-epoch-info";
import { deserializeDataForRewardCalculation } from "../../../libs/ftso-core/src/utils/stat-info/reward-calculation-data";


function extractName(hexInput: string) {
  const hex = hexInput.startsWith("0x") ? hexInput.slice(2) : hexInput;
  let result = "";
  for (let i = 0; i < hex.length; i += 2) {
    const charHexCode = hex.slice(i, i + 2);
    if (charHexCode === "00") {
      continue;
    }
    result += String.fromCharCode(parseInt(charHexCode, 16));
  }
  return result;
}


async function main() {
  if (!process.argv[2]) {
    throw new Error("no rewardEpochId");
  }
  if (!process.argv[3]) {
    throw new Error("no network");
  }

  const rewardEpochId = parseInt(process.argv[2]);
  const network = process.argv[3];

  const calculationFolder = path.join("calculations", network);
  const rewardEpochInfo = deserializeRewardEpochInfo(rewardEpochId, false, calculationFolder);
  let ftsoScalingFunds = 0n;
  for (let offer of rewardEpochInfo.rewardOffers.rewardOffers) {
    ftsoScalingFunds += offer.amount;
  }
  for (let offer of rewardEpochInfo.rewardOffers.inflationOffers) {
    ftsoScalingFunds += offer.amount;
  }

  let fastUpdatesFunds = rewardEpochInfo.fuInflationRewardsOffered.amount;
  for (let incentive of rewardEpochInfo.fuIncentivesOffered) {
    fastUpdatesFunds += incentive.offerAmount;
  }

  let fdcFunds = rewardEpochInfo.fdcInflationRewardsOffered?.amount || 0n;
  const noFDC = rewardEpochInfo.fdcInflationRewardsOffered === undefined;

  let ftsoScalingOfferAmount = 0n;
  let fastUpdatesOfferAmount = 0n;
  let fdcOfferAmount = 0n;
  let fdcOfferBurn = 0n;
  let attestationRequestCount = 0;
  let acceptedAttestationRequestCount = 0;
  for (let votingRoundId = rewardEpochInfo.signingPolicy.startVotingRoundId; votingRoundId <= rewardEpochInfo.endVotingRoundId; votingRoundId++) {
    const ftsoOfferClaims = deserializeGranulatedPartialOfferMap(rewardEpochId, votingRoundId, calculationFolder);
    for (let [_, offers] of ftsoOfferClaims.entries()) {
      for (let offer of offers) {
        ftsoScalingOfferAmount += offer.amount;
      }
    }
    const fuFeedOffers = deserializeGranulatedPartialOfferMapForFastUpdates(rewardEpochId, votingRoundId, calculationFolder);
    for (let [_, offers] of fuFeedOffers.entries()) {
      for (let offer of offers) {
        fastUpdatesOfferAmount += offer.amount;
      }
    }

    const offers = noFDC ? [] : deserializeOffersForFDC(rewardEpochId, votingRoundId, calculationFolder);
    for (let offer of offers) {
      fdcOfferAmount += offer.amount;
      if (offer.shouldBeBurned) {
        fdcOfferBurn += offer.amount;
      }
    }
    const data = deserializeDataForRewardCalculation(
      rewardEpochId,
      votingRoundId,
      false,
      calculationFolder
    );

    if (!noFDC) {
      attestationRequestCount += data.fdcData.attestationRequests.length;
      let reqString = "";
      let i = 0;
      for (let attestationRequest of data.fdcData.attestationRequests) {
        fdcFunds += attestationRequest.fee;
        if (attestationRequest.confirmed) {
          acceptedAttestationRequestCount++;
        }
        const attType = extractName(attestationRequest.data.slice(2, 66)).slice(0, 3);
        const attSource = extractName(attestationRequest.data.slice(66, 130));
        const duplicate = attestationRequest.duplicate ? "D" : "";
        const confirmed = attestationRequest.confirmed ? "C" : "";
        reqString += `${i} ${attType}/${attSource} ${confirmed}${duplicate},`;
        i++;
      }
      if(data.fdcData.attestationRequests.length > 0) {
        const finalized = data.fdcData.firstSuccessfulFinalization ? "F" : "";
        const consensusBitvote = data.fdcData.consensusBitVoteIndices;
        const firstVotingRoundTs = 1658429955;
        const time = firstVotingRoundTs + votingRoundId * 90;
        const date = `${new Date(time * 1000)}`.replace(" GMT+0100 (Central European Standard Time)", "");
        console.log(`${votingRoundId}: ${data.fdcData.attestationRequests.length} ${finalized} ${consensusBitvote.length}/${data.fdcData.attestationRequests.length} | ${consensusBitvote} | ${date} || ${reqString}`);
      }
      
    }
  }

  console.log(`FTSO Scaling Funds: ${ftsoScalingOfferAmount}$ {ftsoScalingFunds - ftsoScalingOfferAmount}`);
  console.log(`Fast Updates Funds: ${fastUpdatesOfferAmount} ${fastUpdatesFunds - fastUpdatesOfferAmount}`);
  console.log(`FDC Funds: ${fdcFunds - fdcOfferAmount}`);
  console.log(`FDC Offer Burn: ${fdcOfferBurn}`);
  console.log(`Total attestation requests: ${attestationRequestCount}, accepted ${acceptedAttestationRequestCount}`);
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
