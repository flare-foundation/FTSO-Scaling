import BN from "bn.js";

import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import { getTestFile } from "../../test-utils/utils/constants";
import { MockContractInstance, VotingManagerInstance, VotingRewardManagerInstance } from "../../typechain-truffle";
import { toBN } from "../../test-utils/utils/test-helpers";
chai.use(chaiBN(BN));

const VotingRewardManager = artifacts.require("VotingRewardManager");
const VotingManager = artifacts.require("VotingManager");
const Mock = artifacts.require("MockContract");

const START_EPOCH = 0;
const FEE_PERCENTAGE_UPDATE_OFFSET = 3;
const DEFAULT_FEE_PERCENTAGE_BIPS = 2000; // 20%

contract(`VotingRewardManager.sol; ${getTestFile(__filename)}`, async accounts => {
    let votingRewardManager: VotingRewardManagerInstance;
    let votingManager: VotingManagerInstance;
    let mock: MockContractInstance;

    let governance: string;
    let dataProvider: string;

    const getEpochIdMethod = () => votingManager.contract.methods.getCurrentRewardEpochId().encodeABI();

    before(async () => {
        governance = accounts[0];
        dataProvider = accounts[1];

        mock = await Mock.new();
        votingManager = await VotingManager.new(governance);

        votingRewardManager = await VotingRewardManager.new(
            governance,
            FEE_PERCENTAGE_UPDATE_OFFSET,
            DEFAULT_FEE_PERCENTAGE_BIPS
        );

        await votingRewardManager.setVoting(mock.address);
        await votingRewardManager.setVotingManager(mock.address);
        await votingRewardManager.setERC20PriceOracle(mock.address);

        await mock.givenMethodReturnUint(getEpochIdMethod(), START_EPOCH);
    });

    it("Should have correct default fee percentage", async () => {
        expect(await votingRewardManager.getDataProviderCurrentFeePercentage(dataProvider)).to.be.equal(DEFAULT_FEE_PERCENTAGE_BIPS);
    });

    it("Should show pending fee percentage changes", async () => {
        const newFeePercentageBips = DEFAULT_FEE_PERCENTAGE_BIPS * 2;
        await votingRewardManager.setDataProviderFeePercentage(newFeePercentageBips, { from: dataProvider });

        const changes = await votingRewardManager.getDataProviderScheduledFeePercentageChanges(dataProvider)
        const { 0: percentages, 1: validFrom, 2: _ } = changes;

        expect(percentages.length).to.equal(1);
        expect(validFrom.length).to.equal(1);
        expect(percentages[0]).to.be.bignumber.equal(toBN(newFeePercentageBips))
        expect(validFrom[0]).to.be.bignumber.equal(toBN(START_EPOCH + FEE_PERCENTAGE_UPDATE_OFFSET))
    });

    it("Should change fee percentage only after update offset expires", async () => {
        const newFeePercentageBips = DEFAULT_FEE_PERCENTAGE_BIPS * 2;
        await votingRewardManager.setDataProviderFeePercentage(newFeePercentageBips, { from: dataProvider });
        expect(await votingRewardManager.getDataProviderCurrentFeePercentage(dataProvider)).to.be.equal(DEFAULT_FEE_PERCENTAGE_BIPS);

        await mock.givenMethodReturnUint(getEpochIdMethod(), START_EPOCH + FEE_PERCENTAGE_UPDATE_OFFSET);
        expect(await votingRewardManager.getDataProviderCurrentFeePercentage(dataProvider)).to.be.equal(newFeePercentageBips);
    });
});
