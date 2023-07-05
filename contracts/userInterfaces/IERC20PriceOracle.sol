// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

interface IERC20PriceOracle {
    struct ERC20Settings {
        bytes8 symbol;
        uint32 maximalValidity;
    }

    function setERC20Settings(
        address erc20Address,
        bytes8 symbol
    ) external;

    function getPrice(address currencyAddress) external view returns (uint32 price, uint32 timestamp);
}

