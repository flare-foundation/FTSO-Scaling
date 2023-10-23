import { readFileSync } from "fs";
import glob from "glob";
import Web3 from "web3";
import { Account } from "web3-core";
import { BareSignature, BlockData, TxData } from "../protocol/voting-types";
import { retry } from "./retry";
import { TransactionReceipt } from "web3-core/types";

export function getWeb3(rpcLink: string, logger?: any): Web3 {
  const web3 = new Web3();
  if (rpcLink.startsWith("http")) {
    web3.setProvider(new Web3.providers.HttpProvider(rpcLink));
  } else if (rpcLink.startsWith("ws")) {
    let provider = new Web3.providers.WebsocketProvider(rpcLink, {
      // @ts-ignore
      clientConfig: {
        keepalive: true,
        keepaliveInterval: 60000, // milliseconds
      },
      reconnect: {
        auto: true,
        delay: 2500,
        onTimeout: true,
      },
    });
    provider.on("close", () => {
      if (logger) {
        logger.error(`WebSocket connection closed.`);
      }
    });
    web3.setProvider(provider);
  }
  web3.eth.handleRevert = true;
  return web3;
}

export async function loadContract<ContractType>(web3: Web3, address: string, name: string) {
  if (!address) throw Error(`Address for ${name} not provided`);
  const abiPath = await relativeContractABIPathForContractName(name);
  const contract = new web3.eth.Contract(getAbi(`artifacts/${abiPath}`), address);
  return contract as ContractType;
}

export function getAccount(web3: Web3, privateKey: string): Account {
  if (privateKey.indexOf("0x") != 0) {
    privateKey = "0x" + privateKey;
  }
  return web3.eth.accounts.privateKeyToAccount(privateKey);
}

export function signMessage(web3: Web3, message: string, privateKey: string): BareSignature {
  const signature = web3.eth.accounts.sign(message, privateKey);
  return {
    v: parseInt(signature.v, 16),
    r: signature.r,
    s: signature.s,
  };
}

/**
 * Returns the address (lowercase) which generated the {@link signature} for the provided {@link message}.
 *
 * Note that an invalid signature, or a signature from a different message, will still result in some public
 * key (address) being recovered. To ensure the signature is correct this will need to be compared to the expected signer.
 */
export function recoverSigner(web3: Web3, message: string, signature: BareSignature): string {
  return web3.eth.accounts.recover(message, "0x" + signature.v.toString(16), signature.r, signature.s).toLowerCase();
}

export function getAbi(abiPath: string) {
  let abi = JSON.parse(readFileSync(abiPath).toString());
  if (abi.abi) {
    abi = abi.abi;
  }
  return abi;
}

export async function relativeContractABIPathForContractName(
  name: string,
  artifactsRoot = "artifacts"
): Promise<string> {
  return new Promise((resolve, reject) => {
    glob(`contracts/**/${name}.sol/${name}.json`, { cwd: artifactsRoot }, (er: any, files: string[] | null) => {
      if (er) {
        reject(er);
      } else {
        if (files && files.length === 1) {
          resolve(files[0]);
        } else {
          reject(files);
        }
      }
    });
  });
}

/**
 * Retrieves block for a given {@link blockNumber} and returns {@link BlockData} containing only transactions to the specified {@link contractAddresses}.
 */
export async function getFilteredBlock(
  web3: Web3,
  blockNumber: number,
  contractAddresses: string[]
): Promise<BlockData> {
  const rawBlock = await web3.eth.getBlock(blockNumber, true);
  if (rawBlock === null) throw new Error(`Block ${blockNumber} not found`);
  if (rawBlock.number === null) throw new Error(`Block ${blockNumber} is still pending.`);

  const relevantContracts = new Set(contractAddresses);
  const relevantTransactions = rawBlock.transactions.filter(tx => tx.to != null && relevantContracts.has(tx.to));
  const receiptPromises = relevantTransactions.map(async tx => {
    let receipt: TransactionReceipt;
    try {
      receipt = await retry(async () => web3.eth.getTransactionReceipt(tx.hash));
    } catch (e) {
      throw new Error(`Error getting receipt for block ${blockNumber} tx ${JSON.stringify(tx, null, 2)}`, { cause: e });
    }
    if (receipt === null) {
      throw new Error(`Receipt for transaction ${tx.hash} is null, transaction: ${JSON.stringify(tx, null, 2)}`);
    }
    return receipt;
  });

  const receipts = await Promise.all(receiptPromises);

  const blockData: BlockData = {
    number: rawBlock.number,
    timestamp: parseInt("" + rawBlock.timestamp, 10),
    transactions: relevantTransactions.map((tx, i) => {
      const txData: TxData = {
        blockNumber: tx.blockNumber!,
        hash: tx.hash,
        input: tx.input,
        from: tx.from,
        to: tx.to,
        value: tx.value,
        receipt: receipts[i],
      };
      return txData;
    }),
  };
  return blockData;
}

/**
 * List of error message excerpts returned by the Web3js client
 * which indicate a transient issue (for which we can attempt to retry).
 */
const transientTxErrorMsgs = [
  "Failed to check for transaction receipt",
  "Transaction was not mined",
  "Invalid JSON RPC response",
  "nonce too low",
].map(msg => msg.toLowerCase());

export function isTransientTxError(error: Error): boolean {
  const errorMsg = error.message.toLowerCase();
  return transientTxErrorMsgs.some(msg => errorMsg.includes(msg));
}

export function isRevertError(error: Error): boolean {
  return error.message.includes("Transaction has been reverted by the EVM");
}

/**
 * Returns the block number with timestamp earlier than {@link timestampMs}.
 *
 * NOTE: This code is auto-generated by Copilot. Need to test it properly if we decide to keep this logic.
 */
export async function getBlockNumberBefore(web3: Web3, timestampMs: number): Promise<number> {
  const latestBlock = await web3.eth.getBlock("latest");
  const latestBlockTimestamp = +latestBlock.timestamp * 1000; // Convert to ms
  const latestBlockNumber = latestBlock.number;

  if (latestBlockTimestamp < timestampMs) {
    return latestBlockNumber;
  }

  let left = 0;
  let right = latestBlockNumber;
  let mid = Math.floor((left + right) / 2);

  while (left <= right) {
    const block = await web3.eth.getBlock(mid);
    const blockTimestamp = +block.timestamp * 1000; // Convert to ms

    if (blockTimestamp < timestampMs) {
      if (mid === latestBlockNumber || +(await web3.eth.getBlock(mid + 1)).timestamp * 1000 >= timestampMs) {
        return mid;
      } else {
        left = mid + 1;
      }
    } else {
      right = mid - 1;
    }

    mid = Math.floor((left + right) / 2);
  }

  return 0;
}
