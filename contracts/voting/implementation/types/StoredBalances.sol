// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

struct StoredBalances {
    mapping(address => uint256) balanceForTokenContract;
    address[] tokenContracts;
}

function reset(StoredBalances storage storedBalances) {
    address[] storage addrs = storedBalances.tokenContracts;
    for (uint i = 0; i < addrs.length; ++i) {
        delete storedBalances.balanceForTokenContract[addrs[i]];
    }
    delete storedBalances.tokenContracts;
}

function currencyBalance(StoredBalances storage storedBalances, address tokenAddr)
view returns (uint256) 
{
    return storedBalances.balanceForTokenContract[tokenAddr];
}

function credit(StoredBalances storage storedBalances, address tokenAddr, address thisAddr, uint256 amount) {
    if (tokenAddr != address(0)) {
        IERC20 token = IERC20(tokenAddr);
        require(token.transferFrom(tokenAddr, thisAddr, amount),
            "couldn't transfer currency amount to reward manager");
    }

    mapping(address => uint256) storage balanceMapping = storedBalances.balanceForTokenContract;
    if (balanceMapping[tokenAddr] == 0) {
        storedBalances.tokenContracts.push(tokenAddr);
    }
    balanceMapping[tokenAddr] += amount;
}

function debit(
    StoredBalances storage storedBalances, 
    address tokenAddr,
    address toAddr, 
    uint256 amount
) {
    mapping(address => uint256) storage balanceMapping = storedBalances.balanceForTokenContract;
    require(balanceMapping[tokenAddr] >= amount, "insufficient token balance");
    balanceMapping[tokenAddr] -= amount; // Assumes we don't subsequently credit, since this can reach 0.

    bool success;
    if (tokenAddr != address(0)) {
        IERC20 token = IERC20(tokenAddr);
        success = token.transfer(toAddr, amount);
    }
    else {
        /* solhint-disable avoid-low-level-calls */
        (success, ) = toAddr.call{value: amount}("");
        /* solhint-enable avoid-low-level-calls */
    }

    require(success, "failed to transfer claimed balance");
}

using { reset, currencyBalance, credit, debit } for StoredBalances global;