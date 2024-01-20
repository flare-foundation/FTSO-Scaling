import Web3 from "web3";
import { TLPEvents, TLPTransaction } from "../orm/entities";
import { IPayloadMessage, PayloadMessage } from "./PayloadMessage";
import { ABICache, AbiData } from "./ABICache";

export class EncodingUtils {
  private readonly coder = new Web3().eth.abi;
  private readonly abiCache = new ABICache(this.coder);

  private static _instance: EncodingUtils | undefined = undefined;
  public static get instance(): EncodingUtils {
    if (!this._instance) {
      this._instance = new EncodingUtils();
    }
    return this._instance;
  }

  /**
   * Returns ABI definition for a given smart contract name and function name
   */
  getFunctionAbiData(contractName: string, functionName: string): AbiData {
    return this.abiCache.getAbi(contractName, functionName);
  }

  /**
   * Returns ABI definition for a given smart contract name and event name
   */
  getEventAbiData(contractName: string, eventName: string): AbiData {
    return this.abiCache.getAbi(contractName, undefined, eventName);
  }

  /**
   * Returns function signature for a given smart contract name and function name
   */
  getFunctionSignature(smartContractName: string, functionName: string): string {
    return this.getFunctionAbiData(smartContractName, functionName).signature;
  }

  /**
   * Returns event signature for a given smart contract name and event name
   */
  getEventSignature(smartContractName: string, eventName: string): string {
    return this.getEventAbiData(smartContractName, eventName).signature;
  }
}

/**
 * Decodes and transforms event @param data obtained from the indexer database,
 * for a given @param smartContractName and @param eventName into target
 * transformation type T, using @param transform function.
 */
export function decodeEvent<T>(
  smartContractName: string,
  eventName: string,
  data: TLPEvents,
  transform: (data: any) => T
): T {
  const abiData = EncodingUtils.instance.getEventAbiData(smartContractName, eventName);
  function prefix0x(x: string) {
    return x.startsWith("0x") ? x : "0x" + x;
  }
  return transform(
    this.coder.decodeLog(
      abiData.abi!.inputs!,
      prefix0x(data.data),
      // Assumption: we will use it only with Solidity generated non-anonymous events from trusted contracts
      [data.topic0, data.topic1, data.topic2, data.topic3].filter(x => x).map(x => prefix0x(x))
    )
  );
}

/**
 * Decode function call data encoded using PayloadMessage
 */
export function decodePayloadMessageCalldata(tx: TLPTransaction): IPayloadMessage<string>[] {
  // input in database is hex string, without 0x, first 4 bytes are function signature
  const payloadData = tx.input!.slice(8); // dropping function signature
  return PayloadMessage.decode(payloadData);
}
