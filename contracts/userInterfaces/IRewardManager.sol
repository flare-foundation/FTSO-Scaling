// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

struct ClaimReward {
    bytes32[] merkleProof;
    ClaimRewardBody claimRewardBody;
}

struct ClaimRewardBody {
    uint256 amount;
    address currencyAddress; // 0 for native currency
    address payable voterAddress;
    uint epochId;
}

/**
 * Defines a rewad offer in native coin or ERC20 token.
 *
 */
struct Offer {
    uint256 amount; // amount of reward in native coin or ERC20 token
    address currencyAddress; // zero address for native currency or address of ERC20 token
    bytes4 offerSymbol; // offer symbol of the reward feed (4-byte encoded string with nulls on the right)
    bytes4 quoteSymbol; // quote symbol of the reward feed (4-byte encoded string with nulls on the right)
    address[] trustedProviders; // list of trusted providers
    uint256 rewardBeltPPM; // reward belt in PPM (parts per million) in relation to the median price of the trusted providers.
    uint256 elasticBandWidthPPM; // elastic band width in PPM (parts per million) in relation to the median price.
    uint256 iqrSharePPM; // Each offer defines IQR and PCT share in PPM (parts per million). The summ of all offers must be 1M.
    uint256 pctSharePPM;
}

abstract contract IRewardManager {
    event RewardOffered(
        uint256 amount, // amount of reward in native coin or ERC20 token
        address currencyAddress, // zero address for native currency or address of ERC20 token
        bytes4 offerSymbol, // offer symbol of the reward feed (4-byte encoded string with nulls on the right)
        bytes4 quoteSymbol, // quote symbol of the reward feed (4-byte encoded string with nulls on the right)
        address[] trustedProviders, // list of trusted providers
        uint256 rewardBeltPPM, // reward belt in PPM (parts per million) in relation to the median price of the trusted providers.
        uint256 elasticBandWidthPPM, // elastic band width in PPM (parts per million) in relation to the median price.
        uint256 iqrSharePPM, // Each offer defines IQR and PCT share in PPM (parts per million). The summ of all offers must be 1M.
        uint256 pctSharePPM,
        uint256 flrValue
    );

    function setVoting(address votingContract) external virtual;

    function setVotingManager(address votingManagerContract) external virtual;

    function setERC20PriceOracle(
        address erc20PriceOracleContract
    ) external virtual;

    function claimReward(ClaimReward calldata _data) external virtual;

    function offerRewards(Offer[] calldata offers) external payable virtual;

    // These functions are not for calling, but for exporting the type definitions in the metadata
    function claimRewardBodyDefinition(
        ClaimRewardBody calldata _data
    ) external {}

    function offerDefinition(Offer calldata _data) external {}
}

function hash(ClaimReward calldata claim) pure returns (bytes32) {
    return keccak256(abi.encode(claim.claimRewardBody));
}

using {hash} for ClaimReward global;
