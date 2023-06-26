// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract DummyERC20 is ERC20 {
    constructor(string memory name, string memory symb) ERC20(name, symb) {}

    function mint(address account, uint amount) external {
        _mint(account, amount);
    }
}