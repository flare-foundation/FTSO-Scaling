// IMPORTANT: This file should never import networks.ts 
import { utils } from "web3";
import { encodeParameter, encodeParameters } from "web3-eth-abi";
import { queryBytesFormat } from "../../libs/ftso-core/src/IndexerClient";
import { TLPEvents, TLPState, TLPTransaction } from "../../libs/ftso-core/src/orm/entities";
import { Bytes20 } from "../../libs/ftso-core/src/voting-types";
import { encodingUtils, web3 } from "./generators";
import { generateRandomAddress, randomHash, unsafeRandomHex } from "./testRandom";


export interface TestVoter {
  identityAddress: string;
  signingAddress: string;
  signingPrivateKey: string;
  submitAddress: string;
  submitSignaturesAddress: string;
  delegationAddress: string;
  registrationWeight: bigint;
  wNatCappedWeight: bigint;
  // Unused
  wNatWeight: bigint;
  nodeIds: Bytes20[];
  nodeWeights: bigint[];
  delegationFeeBIPS: number;
}

export function generateVoter(): TestVoter {
  const signingPrivateKey = utils.randomHex(32);
  const signingAddress = web3.eth.accounts.privateKeyToAccount(signingPrivateKey).address.toLowerCase();
  return {
    identityAddress: generateRandomAddress(),
    signingAddress,
    signingPrivateKey,
    submitAddress: generateRandomAddress(),
    submitSignaturesAddress: generateRandomAddress(),
    delegationAddress: generateRandomAddress(),
    registrationWeight: BigInt(1000),
    wNatCappedWeight: BigInt(1000),
    wNatWeight: BigInt(1000),
    nodeIds: [unsafeRandomHex(20), unsafeRandomHex(20)],
    nodeWeights: [BigInt(1000), BigInt(1000)],
    delegationFeeBIPS: 0,
  };
}

export function generateVoters(count: number): TestVoter[] {
  const voters: TestVoter[] = [];
  for (let i = 0; i < count; i++) {
    voters.push(generateVoter());
  }
  return voters;
}

export function generateState(name: string, id: number, blockNumber?: number, timestamp?: number): TLPState {
  const state = new TLPState();
  state.id = id;
  state.name = name;
  state.index = blockNumber ?? 0;
  state.block_timestamp = timestamp ?? 0;
  state.updated = new Date("2024-01-01");
  return state;
}

export function generateEvent(
  contract: { name: string; address: string; },
  eventName: string,
  eventData: any,
  blockNumber: number,
  timestamp: number
): TLPEvents {
  const topic0 = encodingUtils.getEventSignature(contract.name, eventName);
  const abi = encodingUtils.getEventAbiData(contract.name, eventName);
  const types = abi.abi.inputs.filter(x => !x.indexed).map(x => x.type);
  const values = abi.abi.inputs.filter(x => !x.indexed).map(x => eventData[x.name]);
  const indexedTypes = abi.abi.inputs.filter(x => x.indexed).map(x => x.type);
  const indexedValues = abi.abi.inputs.filter(x => x.indexed).map(x => eventData[x.name]);
  const data = encodeParameters(types, values);

  if (indexedTypes.length > 3) {
    throw new Error("Too many indexed types");
  }

  const e = new TLPEvents();
  e.address = queryBytesFormat(contract.address);
  e.data = queryBytesFormat(data);
  e.topic0 = queryBytesFormat(topic0);
  e.topic1 = indexedValues.length >= 1 ? encodeParameter(indexedTypes[0], indexedValues[0]) : "NULL";
  e.topic2 = indexedValues.length >= 2 ? encodeParameter(indexedTypes[1], indexedValues[1]) : "NULL";
  e.topic3 = indexedValues.length >= 3 ? encodeParameter(indexedTypes[2], indexedValues[2]) : "NULL";
  e.log_index = 1;
  e.block_number = blockNumber;
  e.timestamp = timestamp;
  return e;
}

export function generateTx(
  from: string,
  to: string,
  functionSig: string,
  blockNo: number,
  timestamp: number,
  payload: string,
  status = 1
) {
  const tx = new TLPTransaction();
  tx.block_number = blockNo;
  tx.block_hash = queryBytesFormat(randomHash());
  tx.transaction_index = 0;
  tx.from_address = queryBytesFormat(from);
  tx.to_address = queryBytesFormat(to);
  tx.input = queryBytesFormat(payload);
  tx.status = status;
  tx.value = queryBytesFormat(utils.toHex(1));
  tx.gas_price = queryBytesFormat(utils.toHex(1000));
  tx.gas = 10000;
  tx.timestamp = timestamp;
  tx.hash = queryBytesFormat(randomHash());
  tx.function_sig = queryBytesFormat(functionSig);
  return tx;
}
