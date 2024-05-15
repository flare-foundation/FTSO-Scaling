// PDP (Protocol Data Provider) Response

import { AbiDataInput } from "../../../../libs/ftso-core/src/utils/ABICache";
import { MerkleTree } from "../../../../libs/ftso-core/src/utils/MerkleTree";
import { TreeResult } from "../../../../libs/ftso-core/src/utils/MerkleTreeStructs";
import { MedianCalculationResult, RandomCalculationResult } from "../../../../libs/ftso-core/src/voting-types";

export interface BigInt {
  toJSON: () => string;
}
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
BigInt.prototype.toJSON = function () {
  return this.toString();
};

export enum PDPResponseStatusEnum {
  OK = "OK",
  NOT_AVAILABLE = "NOT_AVAILABLE",
}

export interface PDPResponse {
  status: PDPResponseStatusEnum;
  data: string;
  additionalData?: string;
}

// External user facing response for merkle tree

export enum ExternalResponseStatusEnum {
  OK = "OK",
  TOO_EARLY = "TOO_EARLY",
  NOT_AVAILABLE = "NOT_AVAILABLE",
}

interface ExternalResponseOk {
  status: ExternalResponseStatusEnum.OK;
  votingRoundId: number;
  merkleRoot: string;
  isSecureRandom: boolean;
  tree: TreeResult[];
}

interface ExternalResponseTooEarly {
  status: ExternalResponseStatusEnum.TOO_EARLY;
}

interface ExternalResponseNotAvailable {
  status: ExternalResponseStatusEnum.NOT_AVAILABLE;
}

export type ExternalResponse = ExternalResponseOk | ExternalResponseTooEarly | ExternalResponseNotAvailable;

interface UnencodedResultDataOk {
  status: ExternalResponseStatusEnum.OK;
  votingRoundId: number;
  medianData: MedianCalculationResult[];
  randomData: RandomCalculationResult;
  merkleTree: MerkleTree;
}
interface UnencodedResultDataTooEarly {
  status: ExternalResponseStatusEnum.TOO_EARLY;
}

interface UnencodedResultDataNotAvailable {
  status: ExternalResponseStatusEnum.NOT_AVAILABLE;
}

export type UnencodedResultDataResponse =
  | UnencodedResultDataOk
  | UnencodedResultDataTooEarly
  | UnencodedResultDataNotAvailable;

export interface JSONAbiDefinition {
  abiName: string;
  data: AbiDataInput;
}

interface AbiDefinitionsResponseOk {
  status: ExternalResponseStatusEnum.OK;
  data: JSONAbiDefinition[];
}

interface AbiDefinitionsResponseNotAvailable {
  status: ExternalResponseStatusEnum.NOT_AVAILABLE;
}

export type AbiDefinitionsResponse = AbiDefinitionsResponseOk | AbiDefinitionsResponseNotAvailable;
