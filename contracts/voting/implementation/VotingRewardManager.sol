// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "./../../governance/implementation/Governed.sol";
import "./VotingManager.sol";
import "./Voting.sol";
import "../../userInterfaces/IRewardManager.sol";
// import {MerkleProof} from "../lib/MerkleProof.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

// import "hardhat/console.sol";

contract VotingRewardManager is Governed, IRewardManager {
    using MerkleProof for bytes32[];

    VotingManager public votingManager;
    Voting public voting;

    // The set of (hashes of) claims that have _ever_ been processed successfully.
    mapping(bytes32 => bool) processedRewardClaims;

    // The epoch in which `nextRewardEpochBalance` is accumulated and `previousRewardEpochBalance` is debited.
    uint256 currentRewardEpochId;

    // The total remaining amount of rewards for the most recent reward epochs, from which claims are taken.
    uint256 constant STORED_PREVIOUS_BALANCES = 26;
    uint256[STORED_PREVIOUS_BALANCES] storedRewardEpochBalances;
    uint256 nextRewardEpochBalanceIndex;

    function nextRewardEpochBalance() internal view returns (uint256) {
        return storedRewardEpochBalances[nextRewardEpochBalanceIndex];
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
            storedRewardEpochBalances[nextRewardEpochBalanceIndex] = 0;
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
        uint totalOffered = 0;
        for (uint i = 0; i < offers.length; ++i) {
            totalOffered += offers[i].amount;
        }
        require(msg.value == totalOffered, "total amount offered must equal value sent");
        storedRewardEpochBalances[nextRewardEpochBalanceIndex] += msg.value;
    }
 
    function claimReward(
        ClaimReward calldata _data
    ) override public maybePushRewardBalance {
        ClaimRewardBody memory claim = _data.claimRewardBody;

        require(claim.epochId < currentRewardEpochId,
                "can only claim rewards for previous epochs");

        uint256 previousRewardEpochBalanceIndex = rewardEpochIdAsStoredBalanceIndex(claim.epochId);
                
        require(claim.amount > 0,
                "claimed amount must be greater than 0");

        require(claim.amount <= storedRewardEpochBalances[previousRewardEpochBalanceIndex],
                "claimed amount greater than reward balance");

        bytes32 claimHash = _hashClaimReward(_data);

        require(!processedRewardClaims[claimHash],
                "reward has already been claimed");

        require(_data.merkleProof.verify(voting.getMerkleRoot(claim.epochId), claimHash),
                "Merkle proof for reward failed");

        processedRewardClaims[claimHash] = true;
        storedRewardEpochBalances[previousRewardEpochBalanceIndex] -= claim.amount;

        /* solhint-disable avoid-low-level-calls */
        (bool success, ) = claim.voterAddress.call{value: claim.amount}("");
        /* solhint-enable avoid-low-level-calls */
        require(success, "failed to transfer claimed balance");
    }

    function _hashClaimReward(
        ClaimReward calldata claim
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(claim.claimRewardBody));
    }
}
