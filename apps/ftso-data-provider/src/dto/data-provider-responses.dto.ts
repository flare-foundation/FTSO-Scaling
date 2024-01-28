// PDP (Protocol Data Provider) Response

import { Feed } from "../../../../libs/ftso-core/src/voting-types";

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

export interface TreeNode extends Feed {
  id: number;
}

interface ExternalResponseOk {
  status: ExternalResponseStatusEnum.OK;
  votingRoundId: number;
  merkleRoot: string;
  randomQualityScore: number;
  tree: TreeNode[];
}

interface ExternalResponseTooEarly {
  status: ExternalResponseStatusEnum.TOO_EARLY;
}

interface ExternalResponseNotAvailable {
  status: ExternalResponseStatusEnum.NOT_AVAILABLE;
}

export type ExternalResponse = ExternalResponseOk | ExternalResponseTooEarly | ExternalResponseNotAvailable;
