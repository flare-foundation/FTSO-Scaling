import {
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
} from "@nestjs/common";
import { FtsoCalculatorService } from "./ftso-calculator.service";
import { ApiTags } from "@nestjs/swagger";
import { errorString } from "../../../libs/ftso-core/src/utils/error";

@ApiTags("Flare TSO")
@Controller("ftso/price-controller")
export class FtsoCalculatorController {
  private readonly logger = new Logger(FtsoCalculatorController.name);
  constructor(private readonly ftsoCalculatorService: FtsoCalculatorService) {}

  @Get("commit/:epochId")
  async getCommit(@Param("epochId", ParseIntPipe) epochId: number): Promise<string> {
    return await this.ftsoCalculatorService.getCommit(epochId);
  }

  @Get("reveal/:epochId")
  async getReveal(@Param("epochId", ParseIntPipe) epochId: number): Promise<string> {
    const reveal = await this.ftsoCalculatorService.getReveal(epochId);
    if (reveal === undefined) {
      throw new NotFoundException(`Reveal for epoch ${epochId} not found`);
    }

    // TODO: Come up with a proper ecnoding format
    const serializedReveal = reveal.random.toString() + reveal.priceHex.slice(2);
    return serializedReveal;
  }

  @Get("result/:epochId")
  async getResult(@Param("epochId", ParseIntPipe) epochId: number): Promise<string | undefined> {
    try {
      return await this.ftsoCalculatorService.getResult(epochId);
    } catch (e) {
      this.logger.error(`Error calculating result: ${errorString(e)}`);
      throw new InternalServerErrorException(`Unable to calculate result for epoch ${epochId}`, { cause: e });
    }
  }
}
