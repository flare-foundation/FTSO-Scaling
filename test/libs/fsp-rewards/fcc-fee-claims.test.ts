import { expect } from "chai";
import { EventFragment } from "ethers";
import { readFileSync } from "fs";
import { AbiCache } from "../../../libs/contracts/src/abi/AbiCache";
import { Fdc2AttestationRequested } from "../../../libs/contracts/src/events/Fdc2AttestationRequested";
import { TeeInstructionsSent } from "../../../libs/contracts/src/events/TeeInstructionsSent";
import { FCCDataForVotingRound } from "../../../libs/fsp-rewards/src/data-calculation-interfaces";
import { fccFeeClaims, totalFccFees } from "../../../libs/fsp-rewards/src/reward-calculation/fcc/fcc-fee-claims";
import { RewardTypePrefix } from "../../../libs/fsp-rewards/src/reward-calculation/RewardTypePrefix";
import { ClaimType, RewardClaim } from "../../../libs/fsp-rewards/src/utils/RewardClaim";
import { getTestFile } from "../../utils/getTestFile";

const FCC_FEES_ADDRESS_SONGBIRD = "0x3390E1aDf46568cCC95c3571424937b042094ac2";
const FCC_FEES_ADDRESS_FLARE = "0x2168DB7275C49Af8dBEb11c1298d9e3C0e2a3041";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

// Re-evaluates libs/fsp-rewards/src/constants under the given NETWORK to observe per-network constant values.
function freshConstants(network: string): typeof import("../../../libs/fsp-rewards/src/constants") {
  const modulePath = require.resolve("../../../libs/fsp-rewards/src/constants");
  const originalNetwork = process.env.NETWORK;
  process.env.NETWORK = network;
  delete require.cache[modulePath];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return
    return require("../../../libs/fsp-rewards/src/constants");
  } finally {
    delete require.cache[modulePath];
    if (originalNetwork === undefined) {
      delete process.env.NETWORK;
    } else {
      process.env.NETWORK = originalNetwork;
    }
  }
}

function teeEvent(fee: bigint, rewardEpochId = 419, instructionId = "0x" + "11".repeat(32)): TeeInstructionsSent {
  return {
    extensionId: 0n,
    instructionId,
    rewardEpochId,
    opType: "0x" + "00".repeat(32),
    opCommand: "0x" + "00".repeat(32),
    claimBackAddress: DEAD_ADDRESS,
    fee,
    timestamp: 0,
  } as TeeInstructionsSent;
}

function fdc2Event(fee: bigint, instructionId = "0x" + "11".repeat(32)): Fdc2AttestationRequested {
  return {
    instructionId,
    attestationType: "0x" + "61".repeat(32),
    sourceId: "0x" + "62".repeat(32),
    proofOwner: DEAD_ADDRESS,
    claimBackAddress: DEAD_ADDRESS,
    fee,
    timestamp: 0,
  } as Fdc2AttestationRequested;
}

function fccData(tee: bigint[], fdc2: bigint[], votingRoundId = 1000): FCCDataForVotingRound {
  return {
    votingRoundId,
    teeInstructions: tee.map((fee) => teeEvent(fee)),
    fdc2AttestationRequests: fdc2.map((fee) => fdc2Event(fee)),
  };
}

describe(`FCC event ABIs (${getTestFile(__filename)})`, () => {
  // Guards against copying the wrong artifact: FlareTeeManager is a diamond, so TeeInstructionsSent is not in the
  // FlareTeeManager.sol artifact and must come from the InstructionsFacet artifact.
  it("resolves TeeInstructionsSent to its on-chain topic0", () => {
    expect(AbiCache.instance.getEventSignature("FlareTeeManager", "TeeInstructionsSent")).to.eq(
      "0xf770e69a9fc05b7180797556ec4cedb6108ce2c56ffa76c84aa087efeb5e6963"
    );
  });

  it("resolves the FDC2 AttestationRequested to its on-chain topic0", () => {
    expect(AbiCache.instance.getEventSignature("Fdc2Hub", "AttestationRequested")).to.eq(
      "0x57c4413905bb1b444f93a5eab5a942fae34c0fcaa1c25cc595ce0b990310f5de"
    );
  });

  // FDC2 AttestationRequested and the legacy FDC AttestationRequest differ by two letters; nothing may conflate them.
  it("keeps the FDC2 event distinct from the legacy FDC AttestationRequest event", () => {
    const fdc2 = AbiCache.instance.getEventSignature("Fdc2Hub", "AttestationRequested");
    const legacyFdc = AbiCache.instance.getEventSignature("FdcHub", "AttestationRequest");
    expect(fdc2).to.not.eq(legacyFdc);
    expect(legacyFdc).to.eq("0x251377668af6553101c9bb094ba89c0c536783e005e203625e6cd57345918cc9");
  });

  it("matches the ABI file contents to the event signatures the contracts declare", () => {
    const cases: [string, string, string][] = [
      [
        "FlareTeeManager",
        "TeeInstructionsSent",
        "TeeInstructionsSent(uint256,bytes32,uint32,(address,address,string)[],bytes32,bytes32,bytes,address[],uint64,address,uint256)",
      ],
      ["Fdc2Hub", "AttestationRequested", "AttestationRequested(bytes32,bytes32,bytes32,address,address,uint256)"],
    ];
    for (const [contractName, eventName, signature] of cases) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const abi = JSON.parse(readFileSync(`abi/${contractName}.json`).toString()).abi;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const fragment = EventFragment.from(abi.find((x: { name: string }) => x.name === eventName));
      expect(fragment.format("sighash")).to.eq(signature);
    }
  });
});

describe(`FCC constants (${getTestFile(__filename)})`, () => {
  it("uses the FCC fees address and activates at reward epoch 419 on Songbird", () => {
    const constants = freshConstants("songbird");
    expect(constants.FCC_FEES_ADDRESS).to.eq(FCC_FEES_ADDRESS_SONGBIRD);
    expect(constants.FCC_ACTIVATION_REWARD_EPOCH()).to.eq(419);
    expect(constants.isFccActive(418)).to.eq(false);
    expect(constants.isFccActive(419)).to.eq(true);
    expect(constants.isFccActive(420)).to.eq(true);
  });

  it("has the FCC fees address ready on Flare but keeps FCC inactive there", () => {
    const constants = freshConstants("flare");
    expect(constants.FCC_FEES_ADDRESS).to.eq(FCC_FEES_ADDRESS_FLARE);
    expect(constants.isFccActive(419)).to.eq(false);
  });

  for (const network of ["coston", "coston2", "local-test"]) {
    it(`keeps FCC inactive on ${network}`, () => {
      const constants = freshConstants(network);
      expect(constants.FCC_FEES_ADDRESS).to.eq(DEAD_ADDRESS);
      expect(constants.isFccActive(419)).to.eq(false);
    });
  }

  // The FCC redirection must not disturb the FIP.16 FDC->FIRE split, which is a different pool and path.
  it("keeps the FCC fees address separate from the FIRE pool and burn addresses", () => {
    const songbird = freshConstants("songbird");
    expect(songbird.FCC_FEES_ADDRESS).to.not.eq(songbird.FIRE_POOL_ADDRESS);
    expect(songbird.FCC_FEES_ADDRESS).to.not.eq(songbird.BURN_ADDRESS);
    const flare = freshConstants("flare");
    expect(flare.FCC_FEES_ADDRESS).to.not.eq(flare.FIRE_POOL_ADDRESS);
    expect(flare.FCC_FEES_ADDRESS).to.not.eq(flare.BURN_ADDRESS);
  });
});

describe(`FCC fee claims (${getTestFile(__filename)})`, () => {
  const originalNetwork = process.env.NETWORK;

  before(() => {
    process.env.NETWORK = "local-test";
  });

  after(() => {
    if (originalNetwork === undefined) {
      delete process.env.NETWORK;
    } else {
      process.env.NETWORK = originalNetwork;
    }
  });

  it("emits one claim per fee source, each tagged and summed", () => {
    const claims = fccFeeClaims(1000, fccData([10n, 20n], [5n, 7n]));
    expect(claims.length).to.eq(2);

    const tee = claims.find((c) => c.rewardTypeTag === RewardTypePrefix.FCC_TEE_FEES);
    const fdc2 = claims.find((c) => c.rewardTypeTag === RewardTypePrefix.FCC_FDC2_FEES);
    expect(tee.amount).to.eq(30n);
    expect(fdc2.amount).to.eq(12n);
    for (const claim of claims) {
      expect(claim.claimType).to.eq(ClaimType.DIRECT);
      expect(claim.votingRoundId).to.eq(1000);
      expect(claim.protocolTag).to.eq("FCC");
      // must not collide with the FDC protocol tag that minimal conditions filters on
      expect(claim.protocolTag).to.not.eq("200");
    }
  });

  it("conserves value: claims sum to the total fees observed on chain", () => {
    const data = fccData([13n, 0n, 29n], [4n]);
    const claimTotal = fccFeeClaims(1000, data).reduce((total, claim) => total + claim.amount, 0n);
    expect(claimTotal).to.eq(totalFccFees(data));
    expect(claimTotal).to.eq(46n);
  });

  it("merges both sources into a single DIRECT claim for the FCC fees address", () => {
    const merged = RewardClaim.merge(fccFeeClaims(1000, fccData([10n, 20n], [5n, 7n])));
    expect(merged.length).to.eq(1);
    expect(merged[0].amount).to.eq(42n);
    expect(merged[0].claimType).to.eq(ClaimType.DIRECT);
    expect(merged[0].beneficiary).to.eq(DEAD_ADDRESS.toLowerCase());
  });

  it("omits a source that collected no fees", () => {
    const onlyTee = fccFeeClaims(1000, fccData([10n], []));
    expect(onlyTee.length).to.eq(1);
    expect(onlyTee[0].rewardTypeTag).to.eq(RewardTypePrefix.FCC_TEE_FEES);

    const onlyFdc2 = fccFeeClaims(1000, fccData([], [10n]));
    expect(onlyFdc2.length).to.eq(1);
    expect(onlyFdc2[0].rewardTypeTag).to.eq(RewardTypePrefix.FCC_FDC2_FEES);
  });

  it("produces no claims for a voting round with no FCC activity", () => {
    expect(fccFeeClaims(1000, fccData([], []))).to.deep.eq([]);
    expect(totalFccFees(fccData([], []))).to.eq(0n);
  });

  // An FDC2 request paying P credits F through Fdc2Hub and forwards P - F to FlareTeeManager, so the two events
  // are disjoint parts of the same payment and summing both must reproduce P exactly, without double counting.
  it("accounts for an FDC2 request exactly once across the two paired events", () => {
    const payment = 1000n;
    const configuredFee = 400n;
    const data = fccData([payment - configuredFee], [configuredFee]);
    expect(totalFccFees(data)).to.eq(payment);
  });
});
