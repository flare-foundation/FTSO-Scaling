
// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "../../governance/implementation/Governed.sol";
import "./VotingManager.sol";

contract VoterRegistry is Governed {
    mapping(uint256 => mapping(address => uint256)) public weightForRound;
    mapping(uint256 => uint256) public totalWeightPerRewardEpoch;
    uint256 public thresholdBIPS;
    uint256 public constant MAX_BIPS = 10000;

    VotingManager public votingManager;

    constructor(
        address _governance,
        VotingManager _votingManager,
        uint256 _thresholdBIPS
    ) Governed(_governance) {
        require(_thresholdBIPS > 0, "thresholdBIPS must be > 0");
        require(_thresholdBIPS <= 10000, "thresholdBIPS must be <= 10000");
        votingManager = _votingManager;
        thresholdBIPS = _thresholdBIPS;
    }

    function addVoterWeightForRewardEpoch(
        address _voter,
        uint256 _rewardEpochId,
        uint256 _weight
    ) public onlyGovernance {
        require(
            _rewardEpochId > votingManager.getCurrentRewardEpochId(),
            "rewardEpochId too low"
        );
        totalWeightPerRewardEpoch[_rewardEpochId] += _weight;
        weightForRound[_rewardEpochId][_voter] += _weight;
    }

    function removeVoterForRewardEpoch(
        address _voter,
        uint256 _rewardEpochId
    ) public onlyGovernance {
        require(
            _rewardEpochId > votingManager.getCurrentRewardEpochId(),
            "rewardEpochId too low"
        );
        totalWeightPerRewardEpoch[_rewardEpochId] -= weightForRound[
            _rewardEpochId
        ][_voter];
        weightForRound[_rewardEpochId][_voter] = 0;
    }

    function getVoterWeightForRewardEpoch(
        address _voter,
        uint256 _rewardEpochId
    ) public view returns (uint256) {
        return weightForRound[_rewardEpochId][_voter];
    }

    function thresholdForRewardEpoch(
        uint256 _rewardEpochId
    ) public view returns (uint256) {
        return
            (totalWeightPerRewardEpoch[_rewardEpochId] * thresholdBIPS) /
            MAX_BIPS;
    }

    function voterWeightsInPriceEpoch(
        uint256 _rewardEpochId,
        address[] calldata _voters
    ) public view returns (uint256[] memory weights) {
        weights = new uint256[](_voters.length);
        for (uint256 i = 0; i < _voters.length; i++) {
            weights[i] = getVoterWeightForRewardEpoch(
                _voters[i],
                _rewardEpochId
            );
        }
    }
}
