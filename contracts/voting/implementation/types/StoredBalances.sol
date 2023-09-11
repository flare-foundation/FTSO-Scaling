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

function reset(StoredBalances storage storedBalances) {
    address[] storage addrs = storedBalances.tokenContracts;
    address[] storage voters = storedBalances.voters;
    for (uint i = 0; i < addrs.length; ++i) {
        address addr = addrs[i];
        delete storedBalances.totalRewardForTokenContract[addr];
        delete storedBalances.initializedAmountForTokenContract[addr];
        delete storedBalances.availableAmountForTokenContract[addr];
        for (uint j = 0; j < voters.length; ++j) {
            address voter = voters[j];
            delete storedBalances.unclamedBalanceForTokenContractAndVoter[addr][voter];
            delete storedBalances.totalBalanceForTokenContractAndVoter[addr][voter];
            delete storedBalances.unclaimedWeightForTokenContract[addr][voter];
            delete storedBalances.totalWeightForTokenContractAndVoter[addr][voter];
        } 
    }
    delete storedBalances.tokenContracts;
    delete storedBalances.voters;
}

function initializeForClaiming(
    StoredBalances storage storedBalances,
    address tokenAddr,
    address voter,
    uint256 weight,
    uint256 amount,
    uint256 feePercentage
) {
    mapping(address => uint256) storage totalWeight = storedBalances
        .totalWeightForTokenContractAndVoter[tokenAddr];

    if (totalWeight[voter] > 0 || weight == 0) {  // already initialized or useless to initialize
        return;
    }

    storedBalances.voters.push(voter);

    mapping(address => uint256) storage unclaimedWeight = storedBalances
        .unclaimedWeightForTokenContract[tokenAddr];
    mapping(address => uint256) storage unclamedBalance = storedBalances
        .unclamedBalanceForTokenContractAndVoter[tokenAddr];
    mapping(address => uint256) storage totalBalance = storedBalances
        .totalBalanceForTokenContractAndVoter[tokenAddr];
        
    unclaimedWeight[voter] = weight;
    totalWeight[voter] = weight;

    uint256 fee = 0;
    if(feePercentage > 0) {
        fee = (amount * feePercentage) / 10000;
    }

    unclamedBalance[voter] = amount - fee;
    totalBalance[voter] = amount;

    mapping(address => uint256) storage initializedAmount = storedBalances
        .initializedAmountForTokenContract;

    mapping(address => uint256) storage totalCurrencyAmount = storedBalances
        .totalRewardForTokenContract;

    initializedAmount[tokenAddr] += amount;
    require(
        initializedAmount[tokenAddr] <= totalCurrencyAmount[tokenAddr],
        "initialized amount exceeds total reward"
    );
}

function currencyBalance(
    StoredBalances storage storedBalances,
    address tokenAddr,
    address voter
) view returns (uint256) {
    return
        storedBalances.totalBalanceForTokenContractAndVoter[tokenAddr][voter];
}

function credit(
    StoredBalances storage storedBalances,
    address tokenAddr,
    address thisAddr,
    uint256 amount
) {
    if (tokenAddr != address(0)) {
        IERC20 token = IERC20(tokenAddr);
        require(
            token.transferFrom(msg.sender, thisAddr, amount),
            "couldn't transfer currency amount to reward manager"
        );
    }

    mapping(address => uint256) storage totalAmount = storedBalances
        .totalRewardForTokenContract;
    mapping(address => uint256) storage availableAmount = storedBalances
        .availableAmountForTokenContract;

    if (totalAmount[tokenAddr] == 0) {
        storedBalances.tokenContracts.push(tokenAddr);
    }
    totalAmount[tokenAddr] += amount;
    availableAmount[tokenAddr] += amount;
}

function debit(
    StoredBalances storage storedBalances,
    address tokenAddr,
    address voter,
    address payable toAddr,
    uint256 weightToClaim,
    uint256 additionalAmount
) {
    uint256 weightedAmount = 0;
    if (weightToClaim > 0) {
        // double decreasing balance and weight to avoid rounding errors
        mapping(address => uint256) storage unclaimedBalance = storedBalances
            .unclamedBalanceForTokenContractAndVoter[tokenAddr];
        mapping(address => uint256) storage unclaimedWeightOf = storedBalances
            .unclaimedWeightForTokenContract[tokenAddr];

        uint256 unclaimedWeight = unclaimedWeightOf[voter];
        require(unclaimedWeight > 0, "unclaimed weight is 0");
        weightedAmount = (unclaimedBalance[voter] * weightToClaim) / unclaimedWeight;
        require(weightedAmount <= unclaimedBalance[voter], "insufficient balance");
        unclaimedBalance[voter] -= weightedAmount; // Assumes we don't subsequently credit, since this can reach 0.
        unclaimedWeightOf[voter] -= weightToClaim;
    }

    uint256 claimAmount = weightedAmount + additionalAmount;
    require(claimAmount <= storedBalances.availableAmountForTokenContract[tokenAddr], "insufficient available amount");
    storedBalances.availableAmountForTokenContract[tokenAddr] -= claimAmount;

    bool success;
    if (tokenAddr != address(0)) {        
        IERC20 token = IERC20(tokenAddr);
        success = token.transfer(toAddr, claimAmount);
    } else {
        /* solhint-disable avoid-low-level-calls */
        (success, ) = toAddr.call{value: claimAmount}("");
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
