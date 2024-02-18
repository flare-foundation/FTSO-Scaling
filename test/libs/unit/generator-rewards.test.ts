import FakeTimers from "@sinonjs/fake-timers";
import { expect } from "chai";
import { DataSource, EntityManager } from "typeorm";
import { DataManager } from "../../../libs/ftso-core/src/DataManager";
import { IndexerClient } from "../../../libs/ftso-core/src/IndexerClient";
import { RewardEpochManager } from "../../../libs/ftso-core/src/RewardEpochManager";
import { BURN_ADDRESS, EPOCH_SETTINGS } from "../../../libs/ftso-core/src/configs/networks";
import { rewardClaimsForRewardEpoch } from "../../../libs/ftso-core/src/reward-calculation/reward-calculation";
import { emptyLogger } from "../../../libs/ftso-core/src/utils/ILogger";
import { ClaimType, IPartialRewardClaim, IRewardClaim, RewardClaim } from "../../../libs/ftso-core/src/utils/RewardClaim";
import { Feed } from "../../../libs/ftso-core/src/voting-types";
import { TestVoter, generateVoters } from "../../utils/basic-generators";
import { getDataSource } from "../../utils/db";
import { RewardDataSimulationScenario, generateRewardEpochDataForRewardCalculation, happyRewardDataSimulationScenario, voterFeedValue } from "../../utils/generators-rewards";
import { getTestFile } from "../../utils/getTestFile";
import { printSummary } from "../../utils/indexer-db-summary";
import { calculateVoterClaimSummaries, claimSummary, offersSummary, votersSummary } from "../../utils/reward-claim-summaries";
import {
  defaultSigningPolicyProtocolSettings,
  realtimeShorterEpochSettings,
  resetEnvVariables,
  resetEpochSettings,
  rewardSettingsForRealtimeShorterEpochSettings,
  setupEnvVariables,
  setupEpochSettings,
} from "../../utils/test-epoch-settings";

// Ensure that the networks are not loaded

let useEmptyLogger = true;
const logger = useEmptyLogger ? emptyLogger : console;

////////////////

describe.only(`generator-rewards, ${getTestFile(__filename)}`, () => {
  let numberOfVoters: number;
  let feeds: Feed[];
  let voters: TestVoter[];
  let dataSource: DataSource;
  let entityManager: EntityManager;
  let offerAmount: bigint;
  let rewardEpochId: number;
  let clock: FakeTimers.InstalledClock;

  before(async () => {
    // DO NOT CHANGE THESE SETTING AS TESTS BASE ON THME
    clock = FakeTimers.install({ now: Date.now() });
    process.env.NETWORK = "from-env";
    setupEpochSettings(realtimeShorterEpochSettings);
    logger.log("Epoch settings used");
    logger.dir(EPOCH_SETTINGS());
    process.env.RANDOM_GENERATION_BENCHING_WINDOW = "1";
    logger.log(`RANDOM_GENERATION_BENCHING_WINDOW = ${process.env.RANDOM_GENERATION_BENCHING_WINDOW}`);
    setupEnvVariables(rewardSettingsForRealtimeShorterEpochSettings);
    logger.log("Reward settings used");
    logger.dir(rewardSettingsForRealtimeShorterEpochSettings);
    numberOfVoters = 10;
    feeds = [
      { name: "0x4254430055534454", decimals: 2 }, // BTC USDT 38,573.26
      { name: "0x4554480055534454", decimals: 2 }, // ETH USDT 2,175.12
      { name: "0x464c520055534454", decimals: 5 }, // FLR USDT 0.02042
    ];

    voters = generateVoters(numberOfVoters)
    offerAmount = BigInt(1000000);
    rewardEpochId = 1;
  })

  after(() => {
    resetEpochSettings();
    resetEnvVariables();
    clock.uninstall();
  });

  beforeEach(async () => {
    dataSource = await getDataSource(false);
    entityManager = dataSource.createEntityManager();
  });

  afterEach(async () => {
    await dataSource.destroy();
  });


  it("should happy path scenario work", async () => {
    await generateRewardEpochDataForRewardCalculation(
      clock,
      entityManager,
      defaultSigningPolicyProtocolSettings,
      feeds,
      offerAmount,
      rewardEpochId,
      voters,
      voterFeedValue,
      happyRewardDataSimulationScenario,
      logger
    );
    await printSummary(entityManager, voters, undefined, logger);
    const requiredHistoryTimeSec = 2 * EPOCH_SETTINGS().rewardEpochDurationInVotingEpochs * EPOCH_SETTINGS().votingEpochDurationSeconds;
    const earliestTimestamp = Math.floor(clock.Date.now() / 1000) - requiredHistoryTimeSec;
    logger.log("Earliest timestamp", earliestTimestamp);
    const indexerClient = new IndexerClient(entityManager, requiredHistoryTimeSec);
    const rewardEpochManger = new RewardEpochManager(indexerClient);
    const dataManager = new DataManager(indexerClient, rewardEpochManger, console);

    const votingRoundId = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId);
    const benchingWindowRevealOffenders = 1;
    const rewardEpoch = await rewardEpochManger.getRewardEpochForVotingEpochId(votingRoundId);

    const addLog = true;
    const merge = false;
    const claims = await rewardClaimsForRewardEpoch(
      rewardEpoch.rewardEpochId,
      benchingWindowRevealOffenders,
      dataManager,
      rewardEpochManger,
      merge,
      addLog
    );
    const mergedClaims = RewardClaim.convertToRewardClaims(rewardEpoch.rewardEpochId, RewardClaim.merge(claims));
    offersSummary(rewardEpoch.rewardOffers, logger);
    votersSummary(voters, logger);
    claimSummary(voters, mergedClaims, logger);

    // Number of claims checks
    expect(claims.length).to.equal(960); 
    expect(mergedClaims.length).to.equal(40);
    expect((claims as any).filter(c => c.claimType === ClaimType.DIRECT).length).to.equal(0);
    expect((claims as any).filter(c => c.claimType === ClaimType.FEE).length).to.equal(315);
    expect((claims as any).filter(c => c.claimType === ClaimType.WNAT).length).to.equal(315);
    expect((claims as any).filter(c => c.claimType === ClaimType.MIRROR).length).to.equal(330);
    expect((claims as any).filter(c => c.claimType === ClaimType.CCHAIN).length).to.equal(0);

    expect((mergedClaims as any).filter(c => c.claimType === ClaimType.DIRECT).length).to.equal(0);
    expect((mergedClaims as any).filter(c => c.claimType === ClaimType.FEE).length).to.equal(10);
    expect((mergedClaims as any).filter(c => c.claimType === ClaimType.WNAT).length).to.equal(10);
    expect((mergedClaims as any).filter(c => c.claimType === ClaimType.MIRROR).length).to.equal(20);
    expect((mergedClaims as any).filter(c => c.claimType === ClaimType.CCHAIN).length).to.equal(0);

    // no negative claims
    expect((claims as any).filter(c => c.amount < 0).length).to.equal(0);
    // no direct claims
    expect((claims as any).filter(c => c.claimType === ClaimType.DIRECT).length).to.equal(0);
    // zero burn value
    expect((claims as IPartialRewardClaim[]).filter(c => c.beneficiary.toLowerCase() === BURN_ADDRESS.toLowerCase()).length).to.equal(0);

    const finalizationClaims = (claims as IPartialRewardClaim[]).filter(c => c.info.startsWith("Finalization"));
    expect(finalizationClaims.length).to.equal(60);   // 5 voting rounds x 4 claims x 3 offers x 1 finalizer 
    const feeFinalizationClams = finalizationClaims.filter(c => c.claimType === ClaimType.FEE);
    expect(feeFinalizationClams.length).to.equal(15); // one finalizer x 3 offers x 5 voting rounds

    const signatureClaims = (claims as IPartialRewardClaim[]).filter(c => c.info.startsWith("Signing"));
    // console.dir(finalizationClaims)
    expect (signatureClaims.length).to.equal(600);  // 3 offers x 10 voters x 5 voting rounds x (1 fee + 1 delegation + 2 staking)
    for (const voter of voters) {
      // all voters have fees in merged claims
      const feeClaim = (mergedClaims as IRewardClaim[]).find(c => c.beneficiary.toLowerCase() === voter.identityAddress.toLowerCase() && c.claimType === ClaimType.FEE);
      expect(feeClaim).to.not.be.undefined;
      expect(Number(feeClaim.amount)).gt(0);
      // all voters have delegation rewards in merged claims
      const delegationClaim = (mergedClaims as IRewardClaim[]).find(c => c.beneficiary.toLowerCase() === voter.delegationAddress.toLowerCase() && c.claimType === ClaimType.WNAT);
      expect(delegationClaim).to.not.be.undefined;
      expect(Number(delegationClaim.amount)).gt(0);
      // all nodes of voters have staking rewards in merged claims
      for (const nodeId of voter.nodeIds) {
        const stakingClaim = (mergedClaims as IRewardClaim[]).find(c => c.beneficiary.toLowerCase() === nodeId.toLowerCase() && c.claimType === ClaimType.MIRROR);
        expect(stakingClaim).to.not.be.undefined;
        expect(Number(stakingClaim.amount)).gt(0);
      }
      // each voter has a signature claims for each voting round
      const signatureFeeClaim = signatureClaims.filter(c => c.beneficiary.toLowerCase() === voter.identityAddress.toLowerCase());
      expect(signatureFeeClaim.length).to.equal(15);  // 3 offers x 5 voting rounds
      for(const c of signatureFeeClaim) {
        expect(Number(c.amount)).gt(0);
        expect(c.claimType).to.equal(ClaimType.FEE);
      }
      const signatureDelegationClaim = signatureClaims.filter(c => c.beneficiary.toLowerCase() === voter.delegationAddress.toLowerCase());
      expect(signatureDelegationClaim.length).to.equal(15); // 3 offers x 5 voting rounds
      for(const c of signatureDelegationClaim) {
        expect(Number(c.amount)).gt(0);
        expect(c.claimType).to.equal(ClaimType.WNAT);
      }
      for (const nodeId of voter.nodeIds) {
        const stakingClaim = signatureClaims.filter(c => c.beneficiary.toLowerCase() === nodeId.toLowerCase());      
        expect(stakingClaim.length).to.equal(15); // 5 voting rounds x 3 offers
        for(const c of stakingClaim) {
          expect(Number(c.amount)).gt(0);
          expect(c.claimType).to.equal(ClaimType.MIRROR);
        }
      }
    }
    // no double signing penalties
    const doubleSigningClaims = (claims as IPartialRewardClaim[]).filter(c => c.info.startsWith("Double signing"));
    expect(doubleSigningClaims.length).to.equal(0);
    // no reveal withholding penalties "Reveal withdrawal"
    const revealWithholdingClaims = (claims as IPartialRewardClaim[]).filter(c => c.info.startsWith("Reveal withdrawal"));
    expect(revealWithholdingClaims.length).to.equal(0);

  });

  it("should first voter never sign and finalize", async () => {
    const firstVoterIndex = 0;
    const scenario: RewardDataSimulationScenario = {
      noSignatureSubmitters: [
        {
          voterIndices: [firstVoterIndex],
          votingRoundIds: [1005, 1006, 1007, 1008, 1009]
        }
      ],
      noGracePeriodFinalizers: [
        {
          voterIndices: [firstVoterIndex],
          votingRoundIds: [1005, 1006, 1007, 1008, 1009]
        }
      ],
      outsideGracePeriodFinalizers: [],
      doubleSigners: [],
      revealWithholders: [],
      independentFinalizersOutsideGracePeriod: [],
    };
    await generateRewardEpochDataForRewardCalculation(
      clock,
      entityManager,
      defaultSigningPolicyProtocolSettings,
      feeds,
      offerAmount,
      rewardEpochId,
      voters,
      voterFeedValue,
      scenario,
      logger
    );
    await printSummary(entityManager, voters, undefined, logger);
    const requiredHistoryTimeSec = 2 * EPOCH_SETTINGS().rewardEpochDurationInVotingEpochs * EPOCH_SETTINGS().votingEpochDurationSeconds;
    const earliestTimestamp = Math.floor(clock.Date.now() / 1000) - requiredHistoryTimeSec;
    logger.log("Earliest timestamp", earliestTimestamp);
    const indexerClient = new IndexerClient(entityManager, requiredHistoryTimeSec);
    const rewardEpochManger = new RewardEpochManager(indexerClient);
    const dataManager = new DataManager(indexerClient, rewardEpochManger, console);

    const votingRoundId = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId);
    const benchingWindowRevealOffenders = 1;
    const rewardEpoch = await rewardEpochManger.getRewardEpochForVotingEpochId(votingRoundId);

    const addLog = true;
    const merge = false;
    const claims = await rewardClaimsForRewardEpoch(
      rewardEpoch.rewardEpochId,
      benchingWindowRevealOffenders,
      dataManager,
      rewardEpochManger,
      merge,
      addLog
    );
    const mergedClaims = RewardClaim.convertToRewardClaims(rewardEpoch.rewardEpochId, RewardClaim.merge(claims));
    offersSummary(rewardEpoch.rewardOffers, logger);
    votersSummary(voters, logger);
    claimSummary(voters, mergedClaims, logger);

    // extract signing claims
    const signatureClaims = (claims as IPartialRewardClaim[]).filter(c => c.info.startsWith("Signing"));
    const finalizationClaims = (claims as IPartialRewardClaim[]).filter(c => c.info.startsWith("Finalization"));
    expect(signatureClaims.length).to.equal(540);  // 3 offers x 9 voters x 5 voting rounds x (1 fee + 1 delegation + 2 staking)
    const feeFinalizationClams = finalizationClaims.filter(c => c.claimType === ClaimType.FEE);
    expect(feeFinalizationClams.length).to.equal(12); // 3 offers x 4 voting rounds (1 finalizer per voting round, amoung them is the first voter)
    expect(claims.length).to.equal(960 - 60 - 12 + 3);   // 60 less signature claims + 12 less finalization claims, but 3 additional burn claims
    // exacty 1/5 of finalization rewards should be burned
    const finalizationTotalAmount = finalizationClaims.map(c => c.amount).reduce((a, b) => a + b, BigInt(0));
    const finalizationBurnAmount = finalizationClaims.filter(c => c.beneficiary.toLowerCase() === BURN_ADDRESS.toLowerCase()).map(c => c.amount).reduce((a, b) => a + b, BigInt(0));
    expect(finalizationBurnAmount * 5n).to.equal(finalizationTotalAmount);

    const claimSummaries = calculateVoterClaimSummaries(voters, claims);
    // console.dir(claimSummaries);

    // Alternative test
    expect(claimSummaries.length).to.equal(numberOfVoters + 1); // burn claim because nobody finalizes a round
    expect(claimSummaries[numberOfVoters].externalVoter.toLowerCase()).to.equal(BURN_ADDRESS.toLowerCase());
    expect(claimSummaries[numberOfVoters].directClaims.length).to.equal(3);

    expect(claimSummaries[firstVoterIndex].signingFees.length).to.equal(0); 
    expect(claimSummaries[firstVoterIndex].signingDelegationRewards.length).to.equal(0);
    expect(claimSummaries[firstVoterIndex].signingNodeIdRewards.length).to.equal(0);
    expect(claimSummaries[firstVoterIndex].finalizationFees.length).to.equal(0);
    expect(claimSummaries[firstVoterIndex].finalizationDelegationRewards.length).to.equal(0);
    expect(claimSummaries[firstVoterIndex].finalizationNodeIdRewards.length).to.equal(0);
  });

  it("should last voter get penalized for withholding reveal", async () => {
    const lastVoterIndex = 9;
    const scenario: RewardDataSimulationScenario = {
      noSignatureSubmitters: [],
      noGracePeriodFinalizers: [],
      outsideGracePeriodFinalizers: [],
      doubleSigners: [],
      revealWithholders: [
        {
          voterIndices: [lastVoterIndex],
          votingRoundIds: [1005]
        }
      ],
      independentFinalizersOutsideGracePeriod: [],
    };
    await generateRewardEpochDataForRewardCalculation(
      clock,
      entityManager,
      defaultSigningPolicyProtocolSettings,
      feeds,
      offerAmount,
      rewardEpochId,
      voters,
      voterFeedValue,
      scenario,
      logger
    );
    await printSummary(entityManager, voters, undefined, logger);
    const requiredHistoryTimeSec = 2 * EPOCH_SETTINGS().rewardEpochDurationInVotingEpochs * EPOCH_SETTINGS().votingEpochDurationSeconds;
    const earliestTimestamp = Math.floor(clock.Date.now() / 1000) - requiredHistoryTimeSec;
    logger.log("Earliest timestamp", earliestTimestamp);
    const indexerClient = new IndexerClient(entityManager, requiredHistoryTimeSec);
    const rewardEpochManger = new RewardEpochManager(indexerClient);
    const dataManager = new DataManager(indexerClient, rewardEpochManger, console);

    const votingRoundId = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId);
    const benchingWindowRevealOffenders = 1;
    const rewardEpoch = await rewardEpochManger.getRewardEpochForVotingEpochId(votingRoundId);

    const addLog = true;
    const merge = false;
    const claims = await rewardClaimsForRewardEpoch(
      rewardEpoch.rewardEpochId,
      benchingWindowRevealOffenders,
      dataManager,
      rewardEpochManger,
      merge,
      addLog
    );
    const claimSummaries = calculateVoterClaimSummaries(voters, claims);
    expect(claimSummaries.length).to.equal(numberOfVoters);  // no burn claims
    expect(claimSummaries[lastVoterIndex].revealWithdrawalFeePenalties.length).to.equal(3); // 3 offers
    expect(claimSummaries[lastVoterIndex].revealWithdrawalDelegationPenalties.length).to.equal(3); // 3 offers
    expect(claimSummaries[lastVoterIndex].revealWithdrawalNodeIdPenalties.length).to.equal(6); // 3 offers x 2 nodes
    for(let i = 0; i < lastVoterIndex; i++) {
      const summary = claimSummaries[i];
      expect(summary.revealWithdrawalFeePenalties.length).to.equal(0);
      expect(summary.revealWithdrawalDelegationPenalties.length).to.equal(0);
      expect(summary.revealWithdrawalNodeIdPenalties.length).to.equal(0);
    }
  });

  it("should second last voter get penalized for double signing", async () => {
    const secondLastVoterIndex = 8;
    const scenario: RewardDataSimulationScenario = {
      noSignatureSubmitters: [],
      noGracePeriodFinalizers: [],
      outsideGracePeriodFinalizers: [],
      doubleSigners: [
        {
          voterIndices: [secondLastVoterIndex],
          votingRoundIds: [1005]
        }
      ],
      revealWithholders: [],
      independentFinalizersOutsideGracePeriod: [],
    };
    await generateRewardEpochDataForRewardCalculation(
      clock,
      entityManager,
      defaultSigningPolicyProtocolSettings,
      feeds,
      offerAmount,
      rewardEpochId,
      voters,
      voterFeedValue,
      scenario,
      logger
    );
    await printSummary(entityManager, voters, undefined, logger);
    const requiredHistoryTimeSec = 2 * EPOCH_SETTINGS().rewardEpochDurationInVotingEpochs * EPOCH_SETTINGS().votingEpochDurationSeconds;
    const earliestTimestamp = Math.floor(clock.Date.now() / 1000) - requiredHistoryTimeSec;
    logger.log("Earliest timestamp", earliestTimestamp);
    const indexerClient = new IndexerClient(entityManager, requiredHistoryTimeSec);
    const rewardEpochManger = new RewardEpochManager(indexerClient);
    const dataManager = new DataManager(indexerClient, rewardEpochManger, console);

    const votingRoundId = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId);
    const benchingWindowRevealOffenders = 1;
    const rewardEpoch = await rewardEpochManger.getRewardEpochForVotingEpochId(votingRoundId);

    const addLog = true;
    const merge = false;
    const claims = await rewardClaimsForRewardEpoch(
      rewardEpoch.rewardEpochId,
      benchingWindowRevealOffenders,
      dataManager,
      rewardEpochManger,
      merge,
      addLog
    );
    const claimSummaries = calculateVoterClaimSummaries(voters, claims);
    expect(claimSummaries.length).to.equal(numberOfVoters);  // no burn claims, just negative specific claims
    expect(claimSummaries[secondLastVoterIndex].doubleSigningFeePenalties.length).to.equal(3); // 3 offers
    expect(claimSummaries[secondLastVoterIndex].doubleSigningDelegationPenalties.length).to.equal(3); // 3 offers
    expect(claimSummaries[secondLastVoterIndex].doubleSigningNodeIdPenalties.length).to.equal(6); // 3 offers x 2 nodes
    for(let i = 0; i < numberOfVoters; i++) {
      if(i === secondLastVoterIndex) {
        continue;
      }
      const summary = claimSummaries[i];
      expect(summary.doubleSigningFeePenalties.length).to.equal(0);
      expect(summary.doubleSigningDelegationPenalties.length).to.equal(0);
      expect(summary.doubleSigningNodeIdPenalties.length).to.equal(0);
    }
  });

  it("should no voter finalize and an external finalizer finalize in first voting round", async () => {
    const externalVoter = "0x1111111111111111111111111111111111111111";
    const scenario: RewardDataSimulationScenario = {
      noSignatureSubmitters: [],
      noGracePeriodFinalizers: [
        {
          voterIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
          votingRoundIds: [1005]
        }
      ],
      outsideGracePeriodFinalizers: [],
      doubleSigners: [],
      revealWithholders: [],
      independentFinalizersOutsideGracePeriod: [
        {
          votingRoundIds: [1005],
          voterIndex: 0,
          address: externalVoter
        }
      ],
    };
    await generateRewardEpochDataForRewardCalculation(
      clock,
      entityManager,
      defaultSigningPolicyProtocolSettings,
      feeds,
      offerAmount,
      rewardEpochId,
      voters,
      voterFeedValue,
      scenario,
      logger
    );
    await printSummary(entityManager, voters, undefined, logger);
    const requiredHistoryTimeSec = 2 * EPOCH_SETTINGS().rewardEpochDurationInVotingEpochs * EPOCH_SETTINGS().votingEpochDurationSeconds;
    const earliestTimestamp = Math.floor(clock.Date.now() / 1000) - requiredHistoryTimeSec;
    logger.log("Earliest timestamp", earliestTimestamp);
    const indexerClient = new IndexerClient(entityManager, requiredHistoryTimeSec);
    const rewardEpochManger = new RewardEpochManager(indexerClient);
    const dataManager = new DataManager(indexerClient, rewardEpochManger, console);

    const votingRoundId = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId);
    const benchingWindowRevealOffenders = 1;
    const rewardEpoch = await rewardEpochManger.getRewardEpochForVotingEpochId(votingRoundId);

    const addLog = true;
    const merge = false;
    const claims = await rewardClaimsForRewardEpoch(
      rewardEpoch.rewardEpochId,
      benchingWindowRevealOffenders,
      dataManager,
      rewardEpochManger,
      merge,
      addLog
    );
    const claimSummaries = calculateVoterClaimSummaries(voters, claims);
    expect(claimSummaries.length).to.equal(numberOfVoters + 1);  // 1 external voter
    expect(claimSummaries[numberOfVoters].externalVoter.toLowerCase()).to.equal(externalVoter.toLowerCase());
    expect(claimSummaries[numberOfVoters].directClaims.length).to.equal(3);
    let aSet = new Set(claimSummaries[numberOfVoters].directClaims.map(c => c.votingRoundId));
    expect(aSet.size).to.equal(1);
    expect(aSet.has(1005)).to.be.true;
  });

});
