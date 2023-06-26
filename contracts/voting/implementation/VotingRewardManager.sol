// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "./../../governance/implementation/Governed.sol";
import "./VotingManager.sol";
import "./Voting.sol";
import "../../userInterfaces/IRewardManager.sol";
import "./types/StoredBalances.sol";
// import {MerkleProof} from "../lib/MerkleProof.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

// import "hardhat/console.sol";

contract VotingRewardManager is Governed, IRewardManager {
    using MerkleProof for bytes32[];

    VotingManager public votingManager;
    Voting public voting;

    // The set of (hashes of) claims that have _ever_ been processed successfully.
    mapping(bytes32 => bool) processedRewardClaims;

    uint256 currentRewardEpochId;

    // The total remaining amount of rewards for the most recent reward epochs, from which claims are taken.
    uint constant STORED_PREVIOUS_BALANCES = 26;
    StoredBalances[STORED_PREVIOUS_BALANCES] storedRewardEpochBalances;
    uint256 nextRewardEpochBalanceIndex;

    function getNextRewardEpochBalance(address tokenAddress) public view returns (uint balance) {
        balance = storedRewardEpochBalances[nextRewardEpochBalanceIndex].balanceForTokenContract[tokenAddress];
    }

    function getRemainingEpochBalance(address tokenAddress, uint epochId) public view returns (uint balance) {
        balance = storedRewardEpochBalances[rewardEpochIdAsStoredBalanceIndex(epochId)].balanceForTokenContract[tokenAddress];
    }

    function rewardEpochIdAsStoredBalanceIndex(uint256 epochId) internal view returns (uint256) {
        require(epochId + STORED_PREVIOUS_BALANCES >= currentRewardEpochId, 
                "reward balance not preserved for epoch too far in the past");
        // Have to add the modulus to get a nonnegative answer: -a % m == -(a % m)
        return (nextRewardEpochBalanceIndex + (epochId - currentRewardEpochId) + STORED_PREVIOUS_BALANCES)
                % STORED_PREVIOUS_BALANCES;
    }

    // Bookkeeping semantics for anything that affects the reward balances.
    modifier maybePushRewardBalance() {
        uint256 _currentRewardEpochId = votingManager.getCurrentRewardEpochId();
        require (_currentRewardEpochId >= currentRewardEpochId, "(panic) epoch not monotonic");
        if (_currentRewardEpochId > currentRewardEpochId) {
            nextRewardEpochBalanceIndex = rewardEpochIdAsStoredBalanceIndex(_currentRewardEpochId);
            currentRewardEpochId = _currentRewardEpochId;
            storedRewardEpochBalances[nextRewardEpochBalanceIndex].reset();
        }
        _;
    }

    constructor(address _governance) Governed(_governance) {
        require(_governance != address(0), "governance address is zero");
    }

    function setVoting(address _voting) override public onlyGovernance {
        require(address(voting) == address(0), "voting already initialized");
        voting = Voting(_voting);
    }

    function setVotingManager(address _votingManager) override public onlyGovernance {
        require(address(votingManager) == address(0), "voting manager already initialized");
        votingManager = VotingManager(_votingManager);
        currentRewardEpochId = votingManager.getCurrentRewardEpochId();
    }

    // This contract does not have any concept of symbols/price feeds and it is
    // entirely up to the clients to keep track of the total amount allocated to
    // them and determine the correct distribution of rewards to voters.
    // Ultimately, of course, only the actual amount of value stored for an
    // epoch's rewards can be claimed.
    //
    // TODO: support token currencies    
    function offerRewards(
        Offer[] calldata offers
    ) override public payable maybePushRewardBalance {
        StoredBalances storage balances = storedRewardEpochBalances[nextRewardEpochBalanceIndex];
        uint256 totalNativeOffer = 0;
        for (uint i = 0; i < offers.length; ++i) {
            Offer calldata offer = offers[i];
            if (offer.currencyAddress == address(0)) {
                totalNativeOffer += offer.amount;
            }
            balances.credit(offer.currencyAddress, address(this), offer.amount);
        }
        require(totalNativeOffer >= msg.value, "native currency amount offered is less than value sent");
    }
 
    function claimReward(
        ClaimReward calldata _data
    ) override public maybePushRewardBalance {
        ClaimRewardBody memory claim = _data.claimRewardBody;

        require(claim.epochId < currentRewardEpochId,
                "can only claim rewards for previous epochs");

        uint256 previousRewardEpochBalanceIndex = rewardEpochIdAsStoredBalanceIndex(claim.epochId);
        StoredBalances storage balances = storedRewardEpochBalances[previousRewardEpochBalanceIndex];
        address addr = claim.currencyAddress;
        uint256 amt = claim.amount;

        require(amt > 0,
                "claimed amount must be greater than 0");

        require(amt <= balances.currencyBalance(addr),
                "claimed amount greater than reward balance");

        bytes32 claimHash = _data.hash();

        require(!processedRewardClaims[claimHash],
                "reward has already been claimed");

        require(_data.merkleProof.verify(voting.getMerkleRoot(claim.epochId), claimHash),
                "Merkle proof for reward failed");

        processedRewardClaims[claimHash] = true;
        balances.debit(addr, claim.voterAddress, amt);
    }
}