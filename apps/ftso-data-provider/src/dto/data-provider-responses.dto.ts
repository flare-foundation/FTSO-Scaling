// PDP (Protocol Data Provider) Response

import { AbiDataInput } from "../../../../libs/ftso-core/src/utils/ABICache";
import { Feed, MedianCalculationResult, RandomCalculationResult } from "../../../../libs/ftso-core/src/voting-types";

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
  tree: (RandomCalculationResult | MedianCalculationResult)[];
}

interface ExternalResponseTooEarly {
  status: ExternalResponseStatusEnum.TOO_EARLY;
}

interface ExternalResponseNotAvailable {
  status: ExternalResponseStatusEnum.NOT_AVAILABLE;
}

export type ExternalResponse = ExternalResponseOk | ExternalResponseTooEarly | ExternalResponseNotAvailable;

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
