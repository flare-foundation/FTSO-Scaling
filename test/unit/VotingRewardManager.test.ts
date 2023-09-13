import BN from "bn.js";

import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import { getTestFile } from "../../test-utils/utils/constants";
import {
  MockContractInstance,
  VotingInstance,
  VotingManagerInstance,
  VotingRewardManagerInstance,
} from "../../typechain-truffle";
import { ZERO_ADDRESS, hashRewardClaim, toBN, toBytes4 } from "../../src/voting-utils";
import { Feed, RewardClaim, RewardClaimWithProof, RewardOffered } from "../../src/voting-interfaces";
import { hexlifyBN } from "../../src/voting-utils";
import { MerkleTree } from "../../src/MerkleTree";
import { moveToNextRewardEpochStart } from "../../test-utils/utils/voting-test-utils";
import Prando from "prando";
import { PriceEpochRewards } from "../../src/PriceEpochRewards";

chai.use(chaiBN(BN));

const VotingRewardManager = artifacts.require("VotingRewardManager");
const VotingManager = artifacts.require("VotingManager");
const Voting = artifacts.require("Voting");
const Mock = artifacts.require("MockContract");

const START_REWARD_EPOCH = 0;
const FEE_PERCENTAGE_UPDATE_OFFSET = 3;
const DEFAULT_FEE_PERCENTAGE_BIPS = 2_000; // 20%

const REWARD_VALUE = 1_000_000;
const IQR_SHARE = 700_000;
const PCT_SHARE = 300_000;
const ELASTIC_BAND_WIDTH_PPM = 50_000;
const DEFAULT_REWARD_BELT_PPM = 500_000; // 50%
const REWARD_EPOCH_DURATION = 5;

const TOKEN = ZERO_ADDRESS;
const CLAIM_REWARD_EPOCH = START_REWARD_EPOCH + 1;
const REWARD_AMOUNT = toBN(REWARD_VALUE);
const SYMBOL = {
  offerSymbol: "FLR",
  quoteSymbol: "USD",
};
const DEFAULT_VOTER_WEIGHT = toBN(100);

contract(`VotingRewardManager.sol; ${getTestFile(__filename)}`, async accounts => {
  let votingRewardManager: VotingRewardManagerInstance;
  let votingManager: VotingManagerInstance;
  let voting: VotingInstance;
  let mock: MockContractInstance;

  let firstRewardedPriceEpoch: BN;

  const getMerkleRootMethod = () => voting.contract.methods.getMerkleRootForPriceEpoch(0).encodeABI();

  describe("Data provider fee percentage changes", () => {
    const getRewardEpochIdMethod = () => votingManager.contract.methods.getCurrentRewardEpochId().encodeABI();
    let dataProvider: string;
    let governance: string;

    beforeEach(async () => {
      governance = accounts[0];
      dataProvider = accounts[1];
      votingManager = await VotingManager.new(governance);
      mock = await Mock.new();

      votingRewardManager = await VotingRewardManager.new(
        governance,
        FEE_PERCENTAGE_UPDATE_OFFSET,
        DEFAULT_FEE_PERCENTAGE_BIPS
      );
      await votingRewardManager.setVoting(mock.address);
      await votingRewardManager.setVotingManager(mock.address);
      await votingRewardManager.setERC20PriceOracle(mock.address);

      await mock.givenMethodReturnUint(getRewardEpochIdMethod(), START_REWARD_EPOCH);
    });

    it("Should have correct default fee percentage", async () => {
      expect(await votingRewardManager.getDataProviderCurrentFeePercentage(dataProvider)).to.be.equal(
        DEFAULT_FEE_PERCENTAGE_BIPS
      );
    });

    it("Should show pending fee percentage changes", async () => {
      const newFeePercentageBips = DEFAULT_FEE_PERCENTAGE_BIPS * 2;
      await votingRewardManager.setDataProviderFeePercentage(newFeePercentageBips, { from: dataProvider });

      const changes = await votingRewardManager.getDataProviderScheduledFeePercentageChanges(dataProvider);
      const { 0: percentages, 1: validFrom, 2: _ } = changes;

      expect(percentages.length).to.equal(1);
      expect(validFrom.length).to.equal(1);
      expect(percentages[0]).to.be.bignumber.equal(toBN(newFeePercentageBips));
      expect(validFrom[0]).to.be.bignumber.equal(toBN(START_REWARD_EPOCH + FEE_PERCENTAGE_UPDATE_OFFSET));
    });

    it("Should change fee percentage only after update offset expires", async () => {
      const newFeePercentageBips = DEFAULT_FEE_PERCENTAGE_BIPS * 2;
      await votingRewardManager.setDataProviderFeePercentage(newFeePercentageBips, { from: dataProvider });
      expect(await votingRewardManager.getDataProviderCurrentFeePercentage(dataProvider)).to.be.equal(
        DEFAULT_FEE_PERCENTAGE_BIPS
      );

      await mock.givenMethodReturnUint(getRewardEpochIdMethod(), START_REWARD_EPOCH + FEE_PERCENTAGE_UPDATE_OFFSET);
      expect(await votingRewardManager.getDataProviderCurrentFeePercentage(dataProvider)).to.be.equal(
        newFeePercentageBips
      );
    });
  });

  describe("Reward claiming", () => {
    beforeEach(async () => {
      const governance = accounts[0];
      mock = await Mock.new();
      voting = await Voting.new(governance, mock.address);
      votingManager = await VotingManager.new(governance);

      firstRewardedPriceEpoch = await votingManager.getCurrentPriceEpochId();
      await votingManager.configureRewardEpoch(firstRewardedPriceEpoch, REWARD_EPOCH_DURATION);
      await votingManager.configureSigningDuration(180);

      votingRewardManager = await VotingRewardManager.new(
        governance,
        FEE_PERCENTAGE_UPDATE_OFFSET,
        DEFAULT_FEE_PERCENTAGE_BIPS
      );

      await votingRewardManager.setVoting(mock.address);
      await votingRewardManager.setVotingManager(votingManager.address);
      await votingRewardManager.setERC20PriceOracle(mock.address);
    });

    it("Should claim reward offers for multiple epochs", async () => {
      const rewardEpochsToTest = 30; // Make sure this is higher than STORED_PREVIOUS_BALANCES in the smart contract.

      await mock.givenMethodReturnUint(
        voting.contract.methods.getDelegatorWeightForRewardEpoch(ZERO_ADDRESS, ZERO_ADDRESS, 0).encodeABI(),
        DEFAULT_VOTER_WEIGHT
      );
      await mock.givenMethodReturnUint(
        voting.contract.methods.getVoterWeightForPriceEpoch(ZERO_ADDRESS, 0).encodeABI(),
        DEFAULT_VOTER_WEIGHT
      );

      const offerSender = accounts[0];
      const voter = accounts[1];

      const rewardAmount = toBN(REWARD_VALUE);
      const basicOffer: RewardOffered = generateOffer(rewardAmount, SYMBOL, offerSender);
      await votingRewardManager.offerRewards(hexlifyBN([basicOffer]), {
        from: offerSender,
        value: rewardAmount,
      });

      await moveToNextRewardEpochStart(votingManager, firstRewardedPriceEpoch, REWARD_EPOCH_DURATION);

      for (let i = 0; i < rewardEpochsToTest; i++) {
        await votingRewardManager.offerRewards(hexlifyBN([basicOffer]), {
          from: offerSender,
          value: rewardAmount,
        });

        await moveToNextRewardEpochStart(votingManager, firstRewardedPriceEpoch, REWARD_EPOCH_DURATION);

        const claimPriceEpoch = (await votingManager.getCurrentPriceEpochId()).toNumber() - 1;
        const claim: RewardClaim = {
          isFixedClaim: false,
          amount: basicOffer.amount,
          currencyAddress: basicOffer.currencyAddress,
          beneficiary: voter,
          priceEpochId: claimPriceEpoch,
        };

        const claimRewardEpoch = (await votingManager.getCurrentRewardEpochId()).subn(1);
        const claimWithProof = await generateClaimWithProof(claim);
        await votingRewardManager.claimReward(hexlifyBN(claimWithProof), voter, {
          from: voter,
        });
        const remainingBalance = await votingRewardManager.getRemainingRewardEpochBalance(
          claim.currencyAddress,
          claimRewardEpoch
        );
        expect(remainingBalance).to.be.bignumber.equal(toBN(0));
      }
    });

    describe("Claiming scenarios", () => {
      interface Party {
        readonly address: string;
      }
      class Voter implements Party {
        constructor(
          readonly address: string,
          readonly ownWeight: BN = DEFAULT_VOTER_WEIGHT,
          readonly delegators: Delegator[] = []
        ) {}
        get totalWeight(): BN {
          const delegateWeight: BN = this.delegators.reduce((acc, d) => acc.add(d.delegatedWeight), toBN(0));
          return this.ownWeight.add(delegateWeight);
        }
      }

      class Delegator implements Party {
        constructor(readonly address: string, readonly delegatedWeight: BN) {}
      }

      const rng = new Prando(42);
      function randomBips() {
        return rng.nextInt(1, 10_000);
      }
      function randomWeight() {
        return toBN(rng.nextInt(1, 100_000));
      }

      it("Offer by governance, one voter claimer", async () => {
        const sender: Party = { address: accounts[0] };
        const claimers = [new Voter(accounts[1])];

        await generateAndSubmitClaims(sender, claimers, randomBips());
      });

      it("Offer by governance, one voter claimer, no remainder", async () => {
        const sender: Party = { address: accounts[0] };
        const claimers = [new Voter(accounts[1])];

        await generateAndSubmitClaims(sender, claimers, 0);
      });

      it("Offer by governance, one voter claimer, one non-voter claimer", async () => {
        const sender: Party = { address: accounts[0] };
        const claimers = [new Voter(accounts[1]), { address: accounts[2] }];

        await generateAndSubmitClaims(sender, claimers, randomBips());
      });

      it("Offer by governance, two voter claimers", async () => {
        const sender: Party = { address: accounts[0] };
        const claimers = [new Voter(accounts[1]), new Voter(accounts[2])];

        await generateAndSubmitClaims(sender, claimers, randomBips());
      });

      it("Offer by governance, two voter claimers with delegators", async () => {
        const sender: Party = { address: accounts[0] };
        const claimers = [
          new Voter(accounts[1], toBN(100), [
            new Delegator(accounts[3], toBN(50)),
            new Delegator(accounts[4], toBN(60)),
          ]),
          new Voter(accounts[2], toBN(300), []),
        ];

        await generateAndSubmitClaims(sender, claimers, randomBips());
      });

      it("Offer by governance, one voter claimer with many delegators", async () => {
        const sender: Party = { address: accounts[0] };
        const delegators: Delegator[] = [];
        for (let i = 2; i < 100; i++) {
          delegators.push(new Delegator(accounts[i], randomWeight()));
        }
        const claimers = [new Voter(accounts[1], toBN(100), delegators)];

        await generateAndSubmitClaims(sender, claimers, 0);
      });

      it("Offer by governance, one voter claimers with delegators and zero own weight", async () => {
        const sender: Party = { address: accounts[0] };
        const claimers = [
          new Voter(accounts[1], toBN(0), [new Delegator(accounts[3], toBN(50)), new Delegator(accounts[4], toBN(60))]),
        ];

        await generateAndSubmitClaims(sender, claimers, randomBips());
      });

      it("Offer by voter, one voter claimer", async () => {
        const sender: Party = new Voter(accounts[1], toBN(100));
        const claimers = [new Voter(accounts[2])];

        await generateAndSubmitClaims(sender, claimers, randomBips());
      });

      it("Offer by voter, two voter claimers, including sender", async () => {
        const sender: Party = new Voter(accounts[1], toBN(100), [new Delegator(accounts[3], toBN(50))]);
        const claimers = [sender, new Voter(accounts[2])];

        await generateAndSubmitClaims(sender, claimers, randomBips());
      });
      it("Offer by non-voter, one voter claimer, one non-voter claimer", async () => {
        const sender: Party = { address: accounts[1] };
        const claimers = [new Voter(accounts[2]), sender];

        await generateAndSubmitClaims(sender, claimers, randomBips());
      });

      it("Offer by non-voter, two non-voter claimers", async () => {
        const sender: Party = { address: accounts[1] };
        const claimers = [{ address: accounts[2] }, { address: accounts[3] }];

        await generateAndSubmitClaims(sender, claimers, randomBips());
      });

      /**
       * @param claimers will receve an equal part of the offer reward amount (minus the unclaimed share).
       * @param unclaimedShareBips specifies how much of the total reward amount will be back claimed.
       */
      async function generateAndSubmitClaims(offerSender: Party, claimers: Party[], unclaimedShareBips: number) {
        const offer = await sendOfferAndPrepareForClaiming(offerSender.address);

        const rewardPool = REWARD_AMOUNT.mul(toBN(10_000 - unclaimedShareBips)).div(toBN(10_000));
        const unclaimedReward = REWARD_AMOUNT.sub(rewardPool);

        // Note: we divide reward equally here, correct reward allocation is outside the scope of this test.
        const rewardPerClaimer = rewardPool.div(toBN(claimers.length));
        const claimsForParties = new Map<Party, RewardClaim[]>();
        const claimPriceEpoch = (await votingManager.getCurrentPriceEpochId()).subn(1).toNumber();

        for (const claimer of claimers) {
          if (claimer instanceof Voter) await mockDelegatorWeights(claimer, claimPriceEpoch);
        }

        for (let i = 0; i < claimers.length; i++) {
          const claimer = claimers[i];

          let claimAmount = rewardPerClaimer;
          if (i === 0 && unclaimedShareBips === 0) {
            // We don't want back claims, add remainder to the first claimer for simplicity.
            claimAmount = claimAmount.add(rewardPool.mod(rewardPerClaimer));
          }

          const claim: RewardClaim = {
            isFixedClaim: claimer instanceof Voter ? false : true,
            amount: claimAmount,
            currencyAddress: offer.currencyAddress,
            beneficiary: claimer.address,
            priceEpochId: claimPriceEpoch,
          };
          claimsForParties.set(claimer, [claim]);
        }

        if (unclaimedReward > toBN(0)) {
          const backClaim: RewardClaim = {
            isFixedClaim: true,
            amount: unclaimedReward,
            currencyAddress: offer.currencyAddress,
            beneficiary: offerSender.address,
            priceEpochId: claimPriceEpoch,
          };

          const existingClaims = claimsForParties.get(offerSender) ?? [];
          existingClaims.push(backClaim);
          claimsForParties.set(offerSender, PriceEpochRewards.mergeClaims(claimPriceEpoch, existingClaims));
        }

        await submitClaimsAndCheckBalances(claimsForParties);

        const remainingBalance = await votingRewardManager.getRemainingRewardEpochBalance(TOKEN, CLAIM_REWARD_EPOCH);
        expect(remainingBalance).to.be.bignumber.equal(toBN(0));
        expect(await web3.eth.getBalance(votingRewardManager.address)).to.be.bignumber.equal(toBN(0));
      }

      /**
       * Generates and sends a reward offer from {@link sender}, and shifts reward epochs by 2.
       * Sent offer will be registered for the next reward epoch, and will be claimable in the reward epoch after next.
       */
      async function sendOfferAndPrepareForClaiming(sender: string): Promise<RewardOffered> {
        expect(await votingManager.getCurrentRewardEpochId()).to.be.bignumber.equal(toBN(START_REWARD_EPOCH));

        const basicOffer: RewardOffered = generateOffer(REWARD_AMOUNT, SYMBOL, sender);
        await votingRewardManager.offerRewards(hexlifyBN([basicOffer]), {
          from: sender,
          value: REWARD_AMOUNT,
        });

        await moveToNextRewardEpochStart(votingManager, firstRewardedPriceEpoch, REWARD_EPOCH_DURATION);
        await moveToNextRewardEpochStart(votingManager, firstRewardedPriceEpoch, REWARD_EPOCH_DURATION);

        expect(await votingManager.getCurrentRewardEpochId()).to.be.bignumber.equal(toBN(CLAIM_REWARD_EPOCH + 1));
        const balance = await votingRewardManager.getRemainingRewardEpochBalance(ZERO_ADDRESS, CLAIM_REWARD_EPOCH);
        expect(balance).to.be.bignumber.equal(REWARD_AMOUNT);

        return basicOffer;
      }

      async function mockDelegatorWeights(v: Voter, claimPriceEpoch: number) {
        await mock.givenCalldataReturnUint(
          voting.contract.methods.getVoterWeightForPriceEpoch(v.address, claimPriceEpoch).encodeABI(),
          v.totalWeight
        );
        await mock.givenCalldataReturnUint(
          voting.contract.methods
            .getDelegatorWeightForRewardEpoch(v.address, v.address, CLAIM_REWARD_EPOCH)
            .encodeABI(),
          v.ownWeight
        );
        for (const delegator of v.delegators) {
          await mock.givenCalldataReturnUint(
            voting.contract.methods
              .getDelegatorWeightForRewardEpoch(delegator.address, v.address, CLAIM_REWARD_EPOCH)
              .encodeABI(),
            delegator.delegatedWeight
          );
        }
      }

      /** Submits claims and checks the correct reward amount was transferred for each claim. */
      async function submitClaimsAndCheckBalances(claimsForParties: Map<Party, RewardClaim[]>) {
        for (const [claimer, claims] of claimsForParties) {
          for (const claim of claims) {
            const claimWithProof = await generateClaimWithProof(claim);

            const initialBalance = toBN(await web3.eth.getBalance(claimer.address));
            const receipt = await votingRewardManager.claimReward(hexlifyBN(claimWithProof), claimer.address, {
              from: claimer.address,
            });
            const txFee = toBN(receipt.receipt.gasUsed).mul(toBN(receipt.receipt.effectiveGasPrice));
            const finalBalance = toBN(await web3.eth.getBalance(claimer.address));

            let expectedAmountForClaimer = claim.amount;
            if (claimer instanceof Voter && claim.isFixedClaim === false) {
              const dataProviderFee = claim.amount.muln(DEFAULT_FEE_PERCENTAGE_BIPS).divn(10_000);
              let availableBalance = claim.amount.sub(dataProviderFee);
              let availableWeight = claimer.totalWeight;

              const voterOwnWeightClaim = availableBalance.mul(claimer.ownWeight).div(availableWeight);
              expectedAmountForClaimer = voterOwnWeightClaim.add(dataProviderFee);

              availableBalance = availableBalance.sub(voterOwnWeightClaim);
              availableWeight = availableWeight.sub(claimer.ownWeight);

              for (const delegator of claimer.delegators) {
                const initialDelegatorBalance = toBN(await web3.eth.getBalance(delegator.address));
                const receipt = await votingRewardManager.claimReward(hexlifyBN(claimWithProof), delegator.address, {
                  from: delegator.address,
                });
                const txFee = toBN(receipt.receipt.gasUsed).mul(toBN(receipt.receipt.effectiveGasPrice));
                const finalDelegatorBalance = toBN(await web3.eth.getBalance(delegator.address));

                const expectedDelegatorAmount = availableBalance.mul(delegator.delegatedWeight).div(availableWeight);
                availableBalance = availableBalance.sub(expectedDelegatorAmount);
                availableWeight = availableWeight.sub(delegator.delegatedWeight);

                expect(finalDelegatorBalance.sub(initialDelegatorBalance.sub(txFee))).to.be.bignumber.equal(
                  expectedDelegatorAmount
                );
              }
            }
            expect(finalBalance.sub(initialBalance.sub(txFee))).to.be.bignumber.equal(expectedAmountForClaimer);
          }
        }
      }
    });
  });

  /** We mock the smart contract to return a different merkle root containing the {@link claim} for each call. */
  async function generateClaimWithProof(claim: RewardClaim) {
    const claimHash = hashRewardClaim(claim);
    const root = new MerkleTree([claimHash]);
    await mock.givenMethodReturnUint(getMerkleRootMethod(), root.rootBN);
    const claimsWithProof: RewardClaimWithProof = {
      merkleProof: root.getProof(claimHash)!,
      body: claim,
    };
    return claimsWithProof;
  }

  function generateOffer(amount: BN, symbol: Feed, remainderClaimer: string): RewardOffered {
    return {
      amount: amount,
      currencyAddress: TOKEN,
      offerSymbol: toBytes4(symbol.offerSymbol),
      quoteSymbol: toBytes4(symbol.quoteSymbol),
      leadProviders: [],
      rewardBeltPPM: toBN(DEFAULT_REWARD_BELT_PPM),
      flrValue: amount,
      elasticBandWidthPPM: toBN(ELASTIC_BAND_WIDTH_PPM),
      iqrSharePPM: toBN(IQR_SHARE),
      pctSharePPM: toBN(PCT_SHARE),
      remainderClaimer: remainderClaimer.toLowerCase(),
    };
  }
});
