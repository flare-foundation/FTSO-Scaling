import { Injectable } from "@nestjs/common";
import { SubProtocol2 } from "../../../old/src/TopLevelRunner";
import {
  EpochData,
  BareSignature,
} from "../../../libs/ftso-core/src/voting-types";

@Injectable()
export class FtsoCalculatorService implements SubProtocol2 {
  protocolId: number;

  getCommit(epochId: number): Promise<string> {
    throw new Error("Method not implemented.");
  }
  getReveal(epochId: number): Promise<EpochData> {
    throw new Error("Method not implemented.");
  }
  getResult(epochId: number): Promise<[string, BareSignature]> {
    throw new Error("Method not implemented.");
  }
}
