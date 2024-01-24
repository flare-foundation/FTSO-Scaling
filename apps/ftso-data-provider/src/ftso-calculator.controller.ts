import {
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  Param,
  ParseIntPipe,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ExternalResponse, PDPResponse, PDPResponseStatusEnum } from "./dto/data-provider-responses.dto";
import { FtsoCalculatorService } from "./ftso-calculator.service";
import { ConfigService } from "@nestjs/config";

enum ApiTagsEnum {
  PDP = "FTSO Protocol data provider",
  EXTERNAL = "External User Facing API",
}

@Controller("")
export class FtsoCalculatorController {
  private readonly logger = new Logger(FtsoCalculatorController.name);
  constructor(
    private readonly ftsoCalculatorService: FtsoCalculatorService,
    private readonly configService: ConfigService
  ) {}

  // TODO: temp solution for testing
  get fakeStatusByte38() {
    return {
      status: PDPResponseStatusEnum.OK,
      data: `0x${this.configService
        .get<number>("protocol_id")
        .toString(16)
        .padStart(2, "0")}0000A45501777a7662d2939e73fc82d5c15b471ed18971c0341d40c6ae590ced7b898174a0`,
      additionalData:
        "0x9ef41920e142ade76ca9c6d9f63b1d0b3ddad00630cfb220d2e422c06529d2ef068bd068cf025baca3e269e791ff2afadcf26d291c8fc5ec7772166ff4209761",
    };
  }

  get fakeStatusByte32() {
    return {
      status: PDPResponseStatusEnum.OK,
      data: "0x212d7f70aec1447d54a911afb1c86bf52a4602ab8c3d9c8ced0ec948a2cd8a11",
      additionalData:
        "0x9ef41920e142ade76ca9c6d9f63b1d0b3ddad00630cfb220d2e422c06529d2ef068bd068cf025baca3e269e791ff2afadcf26d291c8fc5ec7772166ff4209761",
    };
  }

  // Protocol Data Provider APIs

  @ApiTags(ApiTagsEnum.PDP)
  @Get("submit1/:votingRoundId/:submitAddress")
  async submit1(
    @Param("votingRoundId", ParseIntPipe) votingRoundId: number,
    @Param("submitAddress") submitAddress: string
  ): Promise<PDPResponse> {
    this.logger.log(
      `Calling GET on submit1 with param: votingRoundId ${votingRoundId} and query param: submitAddress ${submitAddress}`
    );
    const data = await this.ftsoCalculatorService.getEncodedCommitData(votingRoundId, submitAddress);
    return {
      status: data ? PDPResponseStatusEnum.OK : PDPResponseStatusEnum.NOT_AVAILABLE,
      data
    };
  }

  @ApiTags(ApiTagsEnum.PDP)
  @Get("submit2/:votingRoundId/:submitAddress")
  async submit2(
    @Param("votingRoundId", ParseIntPipe) votingRoundId: number,
    @Param("submitAddress") submitAddress: string
  ): Promise<PDPResponse> {
    this.logger.log(
      `Calling GET on submit2 with param: votingRoundId ${votingRoundId} and query param: submitAddress ${submitAddress}`
    );
    const data = await this.ftsoCalculatorService.getEncodedRevealData(votingRoundId);
    return {
      status: data ? PDPResponseStatusEnum.OK : PDPResponseStatusEnum.NOT_AVAILABLE,
      data,
    };
  }

  @ApiTags(ApiTagsEnum.PDP)
  @Get("submitSignatures/:votingRoundId/:submitSignaturesAddress")
  async submitSignatures(
    @Param("votingRoundId", ParseIntPipe) votingRoundId: number,
    @Param("submitSignaturesAddress") submitSignaturesAddress: string
  ): Promise<PDPResponse> {
    this.logger.log(
      `Calling GET on submitSignatures with param: votingRoundId ${votingRoundId} and query param: submitSignaturesAddress ${submitSignaturesAddress}`
    );
    const data = await this.ftsoCalculatorService.getEncodedResultData(votingRoundId);
    return {
      status: data ? PDPResponseStatusEnum.OK : PDPResponseStatusEnum.NOT_AVAILABLE,
      data
    };
  }

  @ApiTags(ApiTagsEnum.PDP)
  @Get("submit3/:votingRoundId/:submitAddress")
  async submit3(
    @Param("votingRoundId", ParseIntPipe) votingRoundId: number,
    @Param("submitAddress") submitAddress: string
  ): Promise<PDPResponse> {
    this.logger.log(
      `Calling GET on submit3 with param: votingRoundId ${votingRoundId} and query param: submitAddress ${submitAddress}`
    );
    throw new InternalServerErrorException("Not used in FTSO protocol");
  }

  // Additional standardized facing APIs

  @ApiTags(ApiTagsEnum.EXTERNAL)
  @Get("signedMerkleTree/:votingRoundId")
  async signedMerkleTree(@Param("votingRoundId", ParseIntPipe) votingRoundId: number): Promise<ExternalResponse> {
    this.logger.log(`Calling GET on signedMerkleTree with param: votingRoundId ${votingRoundId}`);
    throw new InternalServerErrorException("Not used in FTSO protocol");
  }
}
