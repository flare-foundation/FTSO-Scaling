import { time, expectEvent } from "@openzeppelin/test-helpers";
import { FTSOClient } from "../src/protocol/FTSOClient";
import { Feed, Offer } from "../src/protocol/voting-types";
import {
  unprefixedSymbolBytes,
  toBN,
  ZERO_ADDRESS,
  toBytes4,
  hexlifyBN,
  feedId,
} from "../src/protocol/utils/voting-utils";
import { DummyERC20 } from "../typechain";
import {
  DummyERC20Instance,
  MockContractInstance,
  PriceOracleInstance,
  VotingRewardManagerInstance,
  VotingManagerInstance,
} from "../typechain-truffle";
import { Event } from "../src/protocol/BlockIndex";
import BN from "bn.js";

const DummyERC20 = artifacts.require("DummyERC20");
export const REWARD_VALUE = toBN("1000999");
const IQR_SHARE = toBN(700000);
const PCT_SHARE = toBN(300000);
const ELASTIC_BAND_WIDTH_PPM = toBN(50000);
const DEFAULT_REWARD_BELT_PPM = toBN(500000); // 50%

export async function offerRewards(
  rewardEpochId: number,
  erc20Coins: DummyERC20Instance[],
  mockPriceOracle: MockContractInstance,
  priceOracle: PriceOracleInstance,
  ftsoClients: FTSOClient[],
  symbols: Feed[],
  votingRewardManager: VotingRewardManagerInstance,
  governance: string,
  leadProviders: string[],
  rewardValue: BN
) {
  console.log(`Offering rewards for epoch ${rewardEpochId}`);
  // Configure mock price oracle to return the correct values for first two symbols
  const now = await time.latest();
  mockPriceOracle.reset();
  mockPriceOracle.givenMethodReturn(
    priceOracle.contract.methods.lastAnchorPriceForSymbol("0x" + unprefixedSymbolBytes(symbols[0])).encodeABI(),
    web3.eth.abi.encodeParameters(["uint32", "uint32"], [REWARD_VALUE, now])
  );
  mockPriceOracle.givenMethodReturn(
    priceOracle.contract.methods.lastAnchorPriceForSymbol("0x" + unprefixedSymbolBytes(symbols[1])).encodeABI(),
    web3.eth.abi.encodeParameters(["uint32", "uint32"], [REWARD_VALUE, now])
  );

  const initialGovernanceBalanceByCoin = new Map<string, BN>();
  const initialVotingRMBalanceByCoin = new Map<string, BN>();

  for (const coin of erc20Coins) {
    await coin.approve(votingRewardManager.address, rewardValue, { from: governance });
    expect(await coin.allowance(governance, votingRewardManager.address)).to.bignumber.equal(rewardValue);

    initialGovernanceBalanceByCoin.set(coin.address, await coin.balanceOf(governance));
    initialVotingRMBalanceByCoin.set(coin.address, await coin.balanceOf(votingRewardManager.address));
  }

  let totalAmount = toBN(0);
  const offersSent: Offer[] = [];
  for (let i = 0; i < symbols.length; i++) {
    const amount = rewardValue.add(toBN(i));

    const basicOffer = generateOfferForSymbol(governance, amount, symbols[i], leadProviders);
    if (i < erc20Coins.length) {
      offersSent.push({ ...basicOffer, currencyAddress: erc20Coins[i].address, amount: rewardValue });
    } else {
      totalAmount = totalAmount.add(amount);
      offersSent.push(basicOffer);
    }
  }

  const initialBalance = await web3.eth.getBalance(votingRewardManager.address);

  await votingRewardManager.offerRewards(hexlifyBN(offersSent), { from: governance, value: totalAmount });

  const finalBalance = await web3.eth.getBalance(votingRewardManager.address);
  expect(finalBalance).to.bignumber.equal(toBN(initialBalance).add(totalAmount));
  for (const coin of erc20Coins) {
    expect(await votingRewardManager.getNextRewardEpochBalance(coin.address)).to.equal(rewardValue);
    expect(await coin.balanceOf(governance)).to.bignumber.equal(
      initialGovernanceBalanceByCoin.get(coin.address)!.sub(REWARD_VALUE)
    );
    expect(await coin.balanceOf(votingRewardManager.address)).to.bignumber.equal(
      initialVotingRMBalanceByCoin.get(coin.address)!.add(REWARD_VALUE)
    );
  }

  for (const client of ftsoClients) {
    await client.processNewBlocks();
    client.registerRewardsForRewardEpoch(rewardEpochId);
    const rewardData: Map<string, Offer[]> = client.rewardCalculator.rewardOffersBySymbol.get(rewardEpochId)!;
    expect([...rewardData.values()].length).to.equal(symbols.length);

    for (let i = 0; i < symbols.length; i++) {
      const offers = rewardData.get(feedId(symbols[i]))!;
      expect(offers.length).to.equal(1);
      if (i == 0 || i == 1) {
        expect(offers[0].amount).to.equal(rewardValue);
      } else {
        expect(offers[0].amount).to.equal(rewardValue.add(toBN(i)));
      }
      expect(offers[0].currencyAddress).to.equal(offersSent[i].currencyAddress);
    }
  }

  console.log(`Finished Offering rewards for epoch ${rewardEpochId}`);
}

export function generateOfferForSymbol(sender: string, amount: BN, symbol: Feed, leadProviders: string[]): Offer {
  const offer: Offer = {
    amount: amount,
    currencyAddress: ZERO_ADDRESS,
    offerSymbol: toBytes4(symbol.offerSymbol),
    quoteSymbol: toBytes4(symbol.quoteSymbol),
    leadProviders: leadProviders,
    rewardBeltPPM: DEFAULT_REWARD_BELT_PPM,
    elasticBandWidthPPM: ELASTIC_BAND_WIDTH_PPM,
    iqrSharePPM: IQR_SHARE,
    pctSharePPM: PCT_SHARE,
    remainderClaimer: sender,
  };
  return offer;
}

export async function syncToLastBlock(ftsoClients: FTSOClient[]) {
  const currentBlockNumber = await web3.eth.getBlockNumber();
  for (const client of ftsoClients) {
    await client.processNewBlocks();
    expect(client.lastProcessedBlockNumber).to.be.equal(currentBlockNumber);
  }
}
export async function preparePrices(
  priceEpochId: number,
  ftsoClients: FTSOClient[],
  votingManager: VotingManagerInstance
) {
  const currentPriceEpoch = (await votingManager.getCurrentPriceEpochId()).toNumber();
  expect(currentPriceEpoch).to.be.equal(priceEpochId);
  // initialPriceEpoch = currentPriceEpoch;
  for (const client of ftsoClients) {
    client.getPricesForEpoch(currentPriceEpoch);
    const numberOfFeeds = client.getPriceProviders(priceEpochId).length;
    const epochData = client.priceEpochData.get(currentPriceEpoch);
    expect(epochData).to.not.be.undefined;
    expect(epochData?.epochId).to.be.equal(currentPriceEpoch);
    expect(epochData?.prices?.length).to.be.equal(numberOfFeeds);
    expect(epochData?.pricesHex?.length! - 2).to.be.equal(numberOfFeeds * 4 * 2);
    expect(epochData?.random?.value.length).to.be.equal(66);
    expect(epochData?.bitVote).to.be.equal("0x00");
  }
}

export async function commit(priceEpochId: number, ftsoClients: FTSOClient[], votingManager: VotingManagerInstance) {
  const currentEpoch = (await votingManager.getCurrentPriceEpochId()).toNumber();
  expect(currentEpoch).to.be.equal(priceEpochId);
  console.log("Commit epoch", currentEpoch);
  for (const client of ftsoClients) {
    await client.commit(currentEpoch);
  }
  for (const client of ftsoClients) {
    await client.processNewBlocks();
    expect(client.index.queryCommits(currentEpoch)?.size).to.be.equal(ftsoClients.length);
  }
}

export async function reveal(priceEpochId: number, ftsoClients: FTSOClient[], votingManager: VotingManagerInstance) {
  const revealEpoch = (await votingManager.getCurrentPriceEpochId()).toNumber() - 1;
  expect(revealEpoch).to.be.equal(priceEpochId);
  console.log("Reveal epoch", revealEpoch);
  for (const client of ftsoClients) {
    await client.reveal(revealEpoch);
  }
  for (const client of ftsoClients) {
    await client.processNewBlocks();
    expect(client.index.queryReveals(revealEpoch)?.size).to.be.equal(ftsoClients.length);
  }
}

export async function calculateVoteResults(
  priceEpochId: number,
  ftsoClients: FTSOClient[],
  votingManager: VotingManagerInstance
) {
  const calculatePriceEpochId = (await votingManager.getCurrentPriceEpochId()).toNumber() - 1;
  expect(calculatePriceEpochId).to.be.greaterThanOrEqual(priceEpochId);
  console.log("Calculate vote results for epoch", calculatePriceEpochId);
  const finalMedianPrice = [];
  const quartile1Price = [];
  const quartile3Price = [];

  for (const client of ftsoClients) {
    await client.calculateResults(calculatePriceEpochId);
    const data = client.priceEpochResults.get(calculatePriceEpochId)!;
    finalMedianPrice.push(data.medianData.map(res => res.data.finalMedianPrice));
    quartile1Price.push(data.medianData.map(res => res.data.quartile1Price));
    quartile3Price.push(data.medianData.map(res => res.data.quartile3Price));

    expect(data.random).to.not.be.undefined;
    const clientRandom = client.priceEpochData.get(calculatePriceEpochId)!.random;
    expect(data.random.equals(clientRandom)).to.be.false;
  }

  const feedNumbers = new Set<number>(ftsoClients.map(client => client.getPriceProviders(priceEpochId).length));
  expect(feedNumbers.size).to.be.equal(1);
  const numberOfFeeds = ftsoClients[0].getPriceProviders(priceEpochId).length;
  for (let i = 0; i < ftsoClients.length - 1; i++) {
    for (let j = 0; j < numberOfFeeds; j++) {
      expect(finalMedianPrice[i][j]).to.be.equal(finalMedianPrice[i + 1][j]);
      expect(quartile1Price[i][j]).to.be.equal(quartile1Price[i + 1][j]);
      expect(quartile3Price[i][j]).to.be.equal(quartile3Price[i + 1][j]);
    }
  }
  for (let j = 0; j < numberOfFeeds; j++) {
    console.log(`\t${quartile1Price[0][j]}\t${finalMedianPrice[0][j]}\t${quartile3Price[0][j]}`);
  }

  const client = ftsoClients[0];
  const rewardClaims = client.priceEpochResults.get(calculatePriceEpochId)?.rewardClaims ?? [];
  const rewardMap = new Map<string, BN>();
  for (const rewardClaim of rewardClaims) {
    const rewardValue = rewardMap.get(rewardClaim?.currencyAddress!) ?? toBN(0);
    rewardMap.set(rewardClaim?.currencyAddress!, rewardValue.add(rewardClaim?.amount!));
  }
}

export async function signAndSend(
  priceEpochId: number,
  ftsoClients: FTSOClient[],
  votingManager: VotingManagerInstance
) {
  const currentEpochId = (await votingManager.getCurrentPriceEpochId()).toNumber();
  expect(currentEpochId - 1).to.be.greaterThanOrEqual(priceEpochId);
  const firstClient = ftsoClients[0];

  let finalized = false;
  const setFinalized = () => {
    finalized = true;
  };
  firstClient.index.once(Event.Finalize, setFinalized);

  for (const client of ftsoClients) {
    await client.signResult(priceEpochId, true); // skip calculation, since we already did it
  }

  for (const client of ftsoClients) {
    await client.tryFinalizeOnceSignaturesReceived(priceEpochId);
  }

  const signaturesTmp = [...firstClient.index.querySignatures(priceEpochId)!.values()].map(([s, _]) => s);
  const merkleRoots = [...new Set(signaturesTmp.map(sig => sig.merkleRoot)).values()];
  expect(merkleRoots.length).to.be.equal(1);
  expect(finalized).to.be.true;
}

export async function publishPriceEpoch(
  priceEpochId: number,
  client: FTSOClient,
  symbols: Feed[],
  priceOracle: PriceOracleInstance
) {
  const receipt = await client.publishPrices(priceEpochId, [...symbols.keys()]);

  for (let i = 0; i < symbols.length; i++) {
    const medianData = client.priceEpochResults
      .get(priceEpochId)!
      .medianData.find(x => x.feed.offerSymbol === symbols[i].offerSymbol);
    const result = await priceOracle.anchorPrices("0x" + unprefixedSymbolBytes(symbols[i]));

    expectEvent(receipt, "PriceFeedPublished", {
      offerSymbol: web3.utils.padRight(toBytes4(symbols[i].offerSymbol), 64),
      quoteSymbol: web3.utils.padRight(toBytes4(symbols[i].quoteSymbol), 64),
      priceEpochId: toBN(priceEpochId),
      price: toBN(medianData!.data.finalMedianPrice),
      timestamp: toBN((result as any).timestamp),
    });

    expect((result as any).price).to.be.bignumber.equal(toBN(medianData!.data.finalMedianPrice));
  }
}

export async function claimRewards(
  votingManager: VotingManagerInstance,
  claimRewardEpoch: number,
  ftsoClients: FTSOClient[],
  claimPriceEpoch: number,
  governance: string,
  votingRewardManager: VotingRewardManagerInstance,
  coins: DummyERC20Instance[]
) {
  const currentRewardEpochId = await votingManager.getCurrentRewardEpochId();
  expect(currentRewardEpochId.toNumber()).to.be.equal(claimRewardEpoch + 1);

  const initialFlrBalance = await web3.eth.getBalance(votingRewardManager.address);
  const initialCoinBalanceByCoin = new Map<string, BN>();
  for (const coin of coins) {
    initialCoinBalanceByCoin.set(coin.address, await coin.balanceOf(votingRewardManager.address));
  }
  let totalClaimedFlr = toBN(0);
  const totalClaimedByCoin = new Map<string, BN>();

  for (const client of ftsoClients) {
    const initalBalanceByCoin = new Map<string, BN>();
    for (const coin of coins) {
      initalBalanceByCoin.set(coin.address, await coin.balanceOf(client.address));
    }
    const originalFlrBalance = toBN(await web3.eth.getBalance(client.address));

    const receipts = await client.claimRewards(claimRewardEpoch);
    let txFee = toBN(0);
    for (const receipt of receipts) {
      txFee = txFee.add(toBN(receipt.receipt.gasUsed).mul(toBN(receipt.receipt.effectiveGasPrice)));
    }
    const finalFlrBalance = toBN(await web3.eth.getBalance(client.address));
    const rewardClaims = client.priceEpochResults
      .get(claimPriceEpoch)
      ?.rewardClaims.filter(c => c.beneficiary === client.address);

    if (rewardClaims === undefined || rewardClaims.length === 0) {
      expect(receipts.length).to.be.equal(0);
      expect(finalFlrBalance).to.be.bignumber.equal(originalFlrBalance);
    } else {
      // Check flr balances
      const flrClaims = rewardClaims.filter(claim => claim!.currencyAddress === ZERO_ADDRESS);
      if (flrClaims.length > 0) {
        const rewardValue = flrClaims.reduce((acc, claim) => acc.add(claim!.amount!), toBN(0));
        totalClaimedFlr = totalClaimedFlr.add(rewardValue);
        expect(rewardValue).to.be.bignumber.equal(finalFlrBalance.sub(originalFlrBalance).add(txFee));
      } else {
        expect(finalFlrBalance).to.be.bignumber.equal(originalFlrBalance.sub(txFee));
      }
      // Check the erc20 claims
      const expectedValueByCoin = new Map<string, BN>();
      const coinClaims = rewardClaims.filter(claim => claim!.currencyAddress !== ZERO_ADDRESS);
      for (const claim of coinClaims) {
        const rewardValue = claim!.amount!;
        const erc20Contract = await DummyERC20.at(claim!.currencyAddress!);
        expectedValueByCoin.set(
          erc20Contract.address,
          (expectedValueByCoin.get(erc20Contract.address) ?? toBN(0)).add(rewardValue)
        );
      }
      for (const [coin, value] of expectedValueByCoin) {
        const erc20Contract = await DummyERC20.at(coin);
        totalClaimedByCoin.set(
          erc20Contract.address,
          (totalClaimedByCoin.get(erc20Contract.address) ?? toBN(0)).add(value)
        );
        expect(await erc20Contract.balanceOf(client.address)).to.be.bignumber.equal(
          initalBalanceByCoin.get(erc20Contract.address)?.add(value)
        );
      }
    }
  }

  // Claim the undistributed rewards
  const offererClaims = ftsoClients[0].generateClaimsWithProofForClaimer(claimRewardEpoch, governance);
  if (offererClaims.length > 0) {
    for (const offererClaim of offererClaims) {
      await votingRewardManager.claimReward(hexlifyBN(offererClaim), governance, { from: governance });
      if (offererClaim.body.currencyAddress === ZERO_ADDRESS) {
        totalClaimedFlr = totalClaimedFlr.add(offererClaim.body.amount);
      } else {
        const coin = offererClaim.body.currencyAddress;
        totalClaimedByCoin.set(coin, (totalClaimedByCoin.get(coin) ?? toBN(0)).add(offererClaim.body.amount));
      }
    }
  }

  // Check the balance of the reward manager
  for (const coin of coins) {
    expect(await coin.balanceOf(votingRewardManager.address)).to.be.bignumber.equal(
      initialCoinBalanceByCoin.get(coin.address)!.sub(totalClaimedByCoin.get(coin.address)!)
    );
  }
  expect(await web3.eth.getBalance(votingRewardManager.address)).to.be.bignumber.equal(
    toBN(initialFlrBalance).sub(totalClaimedFlr)
  );
  console.log(`Finished claiming rewards for epoch ${claimRewardEpoch}`);
}

const REWARD_OFFER_SYMBOL = "FLR";
const REWARD_QUOTE_SYMBOL = "USD";

export function prepareSymbols(numberOfFeeds: number): Feed[] {
  const symbols = [
    {
      // rewarded feed
      offerSymbol: REWARD_OFFER_SYMBOL,
      quoteSymbol: REWARD_QUOTE_SYMBOL,
    },
  ];
  // Dummy feeds
  for (let i = 1; i < numberOfFeeds; i++) {
    symbols.push({
      offerSymbol: `FL${i}`,
      quoteSymbol: REWARD_QUOTE_SYMBOL,
    });
  }
  return symbols;
}
