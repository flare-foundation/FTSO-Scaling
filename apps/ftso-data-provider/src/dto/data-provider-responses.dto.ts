// PDP (Protocol Data Provider) Response

import { AbiDataInput } from "../../../../libs/ftso-core/src/utils/ABICache";
import { FeedResultWithProof, TreeResult } from "../../../../libs/ftso-core/src/utils/MerkleTreeStructs";
import { MedianCalculationResult } from "../../../../libs/ftso-core/src/voting-types";

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

interface ExternalMedianResponseOk {
  status: ExternalResponseStatusEnum.OK;
  votingRoundId: number;
  medianData: MedianCalculationResult[];
}

interface ExternalMedianResponseNotAvailable {
  status: ExternalResponseStatusEnum.NOT_AVAILABLE;
}

interface ExternalMedianResponseTooEarly {
  status: ExternalResponseStatusEnum.TOO_EARLY;
}

export type ExternalMedianResponse =
  | ExternalMedianResponseOk
  | ExternalMedianResponseNotAvailable
  | ExternalMedianResponseTooEarly;

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

interface ExternalFeedWithProofResponseOk {
  status: ExternalResponseStatusEnum.OK;
  feedWithProof: FeedResultWithProof;
}

interface ExternalFeedWithProofResponseNotAvailable {
  status: ExternalResponseStatusEnum.NOT_AVAILABLE;
}

interface ExternalFeedWithProofResponseTooEarly {
  status: ExternalResponseStatusEnum.TOO_EARLY;
}

export type ExternalFeedWithProofResponse =
  | ExternalFeedWithProofResponseOk
  | ExternalFeedWithProofResponseNotAvailable
  | ExternalFeedWithProofResponseTooEarly;
