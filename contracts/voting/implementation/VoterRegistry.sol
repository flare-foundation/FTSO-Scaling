// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "../../governance/implementation/Governed.sol";
import "../../userInterfaces/IVoterRegistry.sol";
import "./VotingManager.sol";

contract VoterRegistry is IVoterRegistry, Governed {
    // rewardEpochId => voter => weight
    mapping(uint256 => mapping(address => uint256)) public weightForRewardEpoch;
    // rewardEpochId => voter => weight
    mapping(uint256 => mapping(address => uint256)) public delegatedWeightForVotersForRewardEpoch;
    // rewardEpochId => delegator => voter => weight
    mapping(uint256 => mapping(address => mapping(address => uint256))) public delegatedWeightForDelegatorsForRewardEpoch;

    mapping(uint256 => uint256) public totalWeightPerRewardEpoch;
    mapping(uint256 => address[]) public rewardEpochToAllVoters;
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

    // function addVotersWithWeightsForRewardEpoch(
    //     uint256 _rewardEpochId,
    //     address[] calldata _voters,
    //     uint256[] calldata _weights
    // ) public onlyGovernance {
    //     require(
    //         _rewardEpochId > votingManager.getCurrentRewardEpochId(),
    //         "rewardEpochId too low"
    //     );
    //     require(
    //         _voters.length == _weights.length,
    //         "voters and weights length mismatch"
    //     );
    //     require(
    //         rewardEpochToAllVoters[_rewardEpochId].length == 0,
    //         "voters already added for this reward epoch"
    //     );
    //     for (uint256 i = 0; i < _voters.length; i++) {
    //         weightForRewardEpoch[_rewardEpochId][_voters[i]] = _weights[i];
    //         rewardEpochToAllVoters[_rewardEpochId].push(_voters[i]);
    //         totalWeightPerRewardEpoch[_rewardEpochId] += _weights[i];
    //     }
    // }

    function registerAsAVoter(
        uint256 _rewardEpochId,
        uint256 _weight
    ) public  {
        require(
            _rewardEpochId > votingManager.getCurrentRewardEpochId(),
            "rewardEpochId too low"
        );
        require(
            weightForRewardEpoch[_rewardEpochId][msg.sender] == 0,
            "voter already registered"
        );
        weightForRewardEpoch[_rewardEpochId][msg.sender] = _weight;
        rewardEpochToAllVoters[_rewardEpochId].push(msg.sender);
        totalWeightPerRewardEpoch[_rewardEpochId] += _weight;
    }

    function delegateWeightForRewardEpoch(
        uint256 _rewardEpochId, 
        address _voter,
        uint256 _weight
    ) public {
        require(weightForRewardEpoch[_rewardEpochId][_voter] > 0, "voter weight must be > 0");
        require(delegatedWeightForDelegatorsForRewardEpoch[_rewardEpochId][msg.sender][_voter] == 0, "delegation already made");
        delegatedWeightForVotersForRewardEpoch[_rewardEpochId][_voter] += _weight;
        delegatedWeightForDelegatorsForRewardEpoch[_rewardEpochId][msg.sender][_voter] = _weight;
    }

    function getVoterWeightForRewardEpoch(
        address _voter,
        uint256 _rewardEpochId
    ) public view returns (uint256) {
        return weightForRewardEpoch[_rewardEpochId][_voter] + delegatedWeightForVotersForRewardEpoch[_rewardEpochId][_voter];
    }

    function getDelegatorWeightForRewardEpochAndVoter(
        address _delegator,
        address _voter,
        uint256 _rewardEpochId
    ) public view returns (uint256) {
        uint256 voterWeightAsDelegator = _delegator == _voter ? weightForRewardEpoch[_rewardEpochId][_voter] : 0;
        return delegatedWeightForDelegatorsForRewardEpoch[_rewardEpochId][_delegator][_voter] + voterWeightAsDelegator;
    }

    function thresholdForRewardEpoch(
        uint256 _rewardEpochId
    ) public view returns (uint256) {
        return
            (totalWeightPerRewardEpoch[_rewardEpochId] * thresholdBIPS) /
            MAX_BIPS;
    }

    function votersForRewardEpoch(
        uint256 _rewardEpochId
    ) public view returns (address[] memory voters, uint256[] memory weights) {
        voters = rewardEpochToAllVoters[_rewardEpochId];
        weights = voterWeightsInRewardEpoch(_rewardEpochId, voters);
    }

    function voterWeightsInRewardEpoch(
        uint256 _rewardEpochId,
        address[] memory _voters
    ) internal view returns (uint256[] memory weights) {
        weights = new uint256[](_voters.length);
        for (uint256 i = 0; i < _voters.length; i++) {
            weights[i] = getVoterWeightForRewardEpoch(
                _voters[i],
                _rewardEpochId
            );
        }
    }
}
