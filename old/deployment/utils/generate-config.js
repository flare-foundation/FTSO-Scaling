const writeFile = require("fs").writeFile;

/* Generates a config file with the specified number of random feeds. */
const numFeeds = 3;
const baseConfig = {
  governancePrivateKey: "<set in .env>",
  rpcUrl: "ws://127.0.0.1:8545/",
  gasLimit: "2500000",
  gasPriceMultiplier: 1.2,
  feeds: [],
};

for (let i = 0; i < numFeeds; i++) {
  const feed = {
    provider: "CcxtPriceFeed",
    symbol: {
      offerSymbol: generateRandomCombination(),
      quoteSymbol: "USDT",
    },
  };
  baseConfig.feeds.push(feed);
}

const filePath = "deployment/config/config-generated.json";
const jsonString = JSON.stringify(baseConfig, null, 2);

writeFile(filePath, jsonString, err => {
  if (err) {
    console.error("Error writing JSON to file:", err);
  } else {
    console.log("JSON written to file successfully.");
  }
});

function generateRandomCombination() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let combination = "";
  for (let i = 0; i < 4; i++) {
    const randomIndex = Math.floor(Math.random() * letters.length);
    combination += letters[randomIndex];
  }
  return combination;
}
