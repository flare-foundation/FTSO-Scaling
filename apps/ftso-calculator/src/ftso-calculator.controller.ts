import { Controller, Get, Param } from "@nestjs/common";
import { FtsoCalculatorService } from "./ftso-calculator.service";
import {
  EpochData,
  BareSignature,
} from "../../../libs/ftso-core/src/voting-types";

@Controller()
export class FtsoCalculatorController {
  constructor(private readonly ftsoCalculatorService: FtsoCalculatorService) {}

  @Get("protocol-id")
  async getProtocolId(): Promise<number> {
    return this.ftsoCalculatorService.protocolId;
  }

  @Get("commit/:epochId")
  async getCommit(@Param("epochId") epochId: number): Promise<string> {
    return this.ftsoCalculatorService.getCommit(epochId);
  }

  @Get("reveal/:epochId")
  async getReveal(
    @Param("epochId") epochId: number
  ): Promise<EpochData | undefined> {
    return this.ftsoCalculatorService.getReveal(epochId);
  }

  @Get("result/:epochId")
  async getResult(
    @Param("epochId") epochId: number
  ): Promise<[string, BareSignature] | undefined> {
    return this.ftsoCalculatorService.getResult(epochId);
  }
}
