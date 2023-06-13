pragma solidity 0.7.6;
pragma abicoder v2;

import "./../../governance/implementation/Governed.sol";
import "./VotingManager.sol";
import "./Voting.sol";
import "../interfaces/IRewardClaim.sol";
// import {MerkleProof} from "../lib/MerkleProof.sol";
import {MerkleProof} from "@openzeppelin/contracts/cryptography/MerkleProof.sol";

// import "hardhat/console.sol";

contract VotingRewardManager is Governed, IRewardClaim {
    using MerkleProof for bytes32[];

    VotingManager public votingManager;
    Voting public voting;

    // The epoch in which `nextRewardEpochBalance` is accumulated and `previousRewardEpochBalance` is debited.
    uint256 currentRewardEpochId;

    // The running total of rewards to be claimed after `currentRewardEpochId` is incremented.
    uint256 nextRewardEpochBalance;

    // The total remaining amount of rewards for the most recent reward epoch, from which claims are taken.
    uint256 previousRewardEpochBalance;

    // The set of (hashes of) claims that have _ever_ been processed successfully.
    mapping(bytes32 => bool) processedRewardClaims;

    // Bookkeeping semantics for anything that affects the reward balances.
    modifier maybePushRewardBalance() {
        uint256 _currentRewardEpochId = votingManager.getCurrentRewardEpochId();
        require (_currentRewardEpochId >= currentRewardEpochId, "(panic) epoch not monotonic");
        if (_currentRewardEpochId > currentRewardEpochId) {
            currentRewardEpochId = _currentRewardEpochId;
            previousRewardEpochBalance = nextRewardEpochBalance;
            nextRewardEpochBalance = 0;
        }
        _;
    }

    constructor(address _governance) Governed(_governance) {
        require(_governance != address(0), "governance address is zero");
        currentRewardEpochId = votingManager.getCurrentRewardEpochId();
    }

    function setVoting(address _voting) public onlyGovernance {
        require(address(voting) == address(0), "voting already initialized");
        voting = Voting(_voting);
        votingManager = voting.votingManager();
    }

    // This function's argument is strictly for off-chain reference.  This contract does not have any concept of
    // symbols/price feeds and it is entirely up to the clients to keep track of the total amount allocated to them
    // and determine the correct distribution of rewards to voters.  Ultimately, of course, only the actual amount
    // of value stored for an epoch's rewards can be claimed.
    function offerReward(
        bytes4 _symbol
    ) public payable maybePushRewardBalance updateBalance {}

    // This has only one purpose: to make `offerReward` have an empty body, suppressing the unused argument warning.
    modifier updateBalance {
        nextRewardEpochBalance += msg.value;
        _;
    }
 
    function claimReward(
        ClaimReward calldata _data
    ) public maybePushRewardBalance {
        require(_data.epochId == currentRewardEpochId - 1, "can only claim rewards for the previous epoch");
        require(_data.amount > 0, "claimed amount must be greater than 0");
        require(_data.amount <= previousRewardEpochBalance, "claimed amount greater than reward balance");

        (bytes32 claimHash, bool unclaimed,) = _verifyClaimReward(_data);
        require(unclaimed, "reward has already been claimed");
        processedRewardClaims[claimHash] = true;
        previousRewardEpochBalance -= _data.amount;

        /* solhint-disable avoid-low-level-calls */
        (bool success, ) = _data.voterAddress.call{value: _data.amount}("");
        /* solhint-enable avoid-low-level-calls */
        require(success, "claim failed");
    }

    // An internal, utility function to reduce code duplication between `claimReward` and `verifyClaimReward`
    function _verifyClaimReward(
        ClaimReward calldata _data
    ) internal view returns (bytes32 claimHash, bool unclaimed, bool proved) {
        claimHash = _hashClaimReward(_data);
        unclaimed = !processedRewardClaims[claimHash];
        proved = _verifyMerkleProof(_data.merkleProof, merkleRootForRound(_data.epochId), claimHash);
    }

    function verifyClaimReward(
        ClaimReward calldata _data
    ) external view override returns (bool _proved) {
        (,, _proved) = _verifyClaimReward(_data);
    }

    function _hashClaimReward(
        ClaimReward calldata _data
    ) private pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    "voter_aggregate",
                    _data.chainId,
                    _data.epochId,
                    _data.voterAddress,
                    _data.amount
                )
            );
    }

    function _verifyMerkleProof(
        bytes32[] memory proof,
        bytes32 merkleRoot,
        bytes32 leaf
    ) internal pure returns (bool) {
        return proof.verify(merkleRoot, leaf);
    }

    function merkleRootForRound(
        uint256 _roundId
    ) public view returns (bytes32 _merkleRoot) {
        return voting.getMerkleRoot(_roundId);
    }
}
