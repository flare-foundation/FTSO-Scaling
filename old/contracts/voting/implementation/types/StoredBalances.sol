// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

struct StoredBalances {
    // currencyAddress => voter => balance
    mapping(address => mapping(address => uint256)) unclamedBalanceForTokenContractAndVoter;
    mapping(address => mapping(address => uint256)) totalBalanceForTokenContractAndVoter;
    // currencyAddress => voter => weight
    mapping(address => mapping(address => uint256)) unclaimedWeightForTokenContract;
    mapping(address => mapping(address => uint256)) totalWeightForTokenContractAndVoter;
    // currencyAddress => balance
    mapping(address => uint256) totalRewardForTokenContract;
    mapping(address => uint256) initializedAmountForTokenContract;
    mapping(address => uint256) availableAmountForTokenContract;
    address[] tokenContracts;
    address[] voters;
}

function reset(StoredBalances storage _storedBalances) {
    address[] storage addrs = _storedBalances.tokenContracts;
    address[] storage voters = _storedBalances.voters;
    for (uint i = 0; i < addrs.length; ++i) {
        address addr = addrs[i];
        delete _storedBalances.totalRewardForTokenContract[addr];
        delete _storedBalances.initializedAmountForTokenContract[addr];
        delete _storedBalances.availableAmountForTokenContract[addr];
        for (uint j = 0; j < voters.length; ++j) {
            address voter = voters[j];
            delete _storedBalances.unclamedBalanceForTokenContractAndVoter[addr][voter];
            delete _storedBalances.totalBalanceForTokenContractAndVoter[addr][voter];
            delete _storedBalances.unclaimedWeightForTokenContract[addr][voter];
            delete _storedBalances.totalWeightForTokenContractAndVoter[addr][voter];
        } 
    }
    delete _storedBalances.tokenContracts;
    delete _storedBalances.voters;
}

function initializeForClaiming(
    StoredBalances storage _storedBalances,
    address _tokenAddr,
    address _voter,
    uint256 _weight,
    uint256 _amount,
    uint256 _feePercentage
) {
    mapping(address => uint256) storage totalWeight = _storedBalances
        .totalWeightForTokenContractAndVoter[_tokenAddr];

    if (totalWeight[_voter] > 0 || _weight == 0) {  // already initialized or useless to initialize
        return;
    }

    _storedBalances.voters.push(_voter);

    mapping(address => uint256) storage unclaimedWeight = _storedBalances
        .unclaimedWeightForTokenContract[_tokenAddr];
    mapping(address => uint256) storage unclamedBalance = _storedBalances
        .unclamedBalanceForTokenContractAndVoter[_tokenAddr];
    mapping(address => uint256) storage totalBalance = _storedBalances
        .totalBalanceForTokenContractAndVoter[_tokenAddr];
        
    unclaimedWeight[_voter] = _weight;
    totalWeight[_voter] = _weight;

    uint256 fee = 0;
    if(_feePercentage > 0) {
        fee = (_amount * _feePercentage) / 10000;
    }

    unclamedBalance[_voter] = _amount - fee;
    totalBalance[_voter] = _amount;

    mapping(address => uint256) storage initializedAmount = _storedBalances
        .initializedAmountForTokenContract;

    mapping(address => uint256) storage totalCurrencyAmount = _storedBalances
        .totalRewardForTokenContract;

    initializedAmount[_tokenAddr] += _amount;
    require(
        initializedAmount[_tokenAddr] <= totalCurrencyAmount[_tokenAddr],
        "initialized amount exceeds total reward"
    );
}

function currencyBalance(
    StoredBalances storage _storedBalances,
    address _tokenAddr,
    address _voter
) view returns (uint256) {
    return
        _storedBalances.totalBalanceForTokenContractAndVoter[_tokenAddr][_voter];
}

function credit(
    StoredBalances storage _storedBalances,
    address _tokenAddr,
    address _thisAddr,
    uint256 _amount
) {
    if (_tokenAddr != address(0)) {
        IERC20 token = IERC20(_tokenAddr);
        require(
            token.transferFrom(msg.sender, _thisAddr, _amount),
            "couldn't transfer currency amount to reward manager"
        );
    }

    mapping(address => uint256) storage totalAmount = _storedBalances
        .totalRewardForTokenContract;
    mapping(address => uint256) storage availableAmount = _storedBalances
        .availableAmountForTokenContract;

    if (totalAmount[_tokenAddr] == 0) {
        _storedBalances.tokenContracts.push(_tokenAddr);
    }
    totalAmount[_tokenAddr] += _amount;
    availableAmount[_tokenAddr] += _amount;
}

function debit(
    StoredBalances storage _storedBalances,
    address _tokenAddr,
    address _voter,
    address payable _toAddr,
    uint256 _weightToClaim,
    uint256 _additionalAmount
) {
    uint256 weightedAmount = 0;
    if (_weightToClaim > 0) {
        // double decreasing balance and weight to avoid rounding errors
        mapping(address => uint256) storage unclaimedBalance = _storedBalances
            .unclamedBalanceForTokenContractAndVoter[_tokenAddr];
        mapping(address => uint256) storage unclaimedWeightOf = _storedBalances
            .unclaimedWeightForTokenContract[_tokenAddr];

        uint256 unclaimedWeight = unclaimedWeightOf[_voter];
        require(unclaimedWeight > 0, "unclaimed weight is 0");
        weightedAmount = (unclaimedBalance[_voter] * _weightToClaim) / unclaimedWeight;
        require(weightedAmount <= unclaimedBalance[_voter], "insufficient balance");
        unclaimedBalance[_voter] -= weightedAmount; // Assumes we don't subsequently credit, since this can reach 0.
        unclaimedWeightOf[_voter] -= _weightToClaim;
    }

    uint256 claimAmount = weightedAmount + _additionalAmount;
    require(claimAmount <= _storedBalances.availableAmountForTokenContract[_tokenAddr], "insufficient available amount");
    _storedBalances.availableAmountForTokenContract[_tokenAddr] -= claimAmount;

    bool success;
    if (_tokenAddr != address(0)) {        
        IERC20 token = IERC20(_tokenAddr);
        success = token.transfer(_toAddr, claimAmount);
    } else {
        /* solhint-disable avoid-low-level-calls */
        (success, ) = _toAddr.call{value: claimAmount}("");
        /* solhint-enable avoid-low-level-calls */
    }
    require(success, "failed to transfer claimed balance");
}

using {
    reset,
    currencyBalance,
    credit,
    debit,
    initializeForClaiming
} for StoredBalances global;
