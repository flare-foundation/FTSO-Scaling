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
import { FtsoDataProviderService } from "./ftso-data-provider.service";
import { ConfigService } from "@nestjs/config";
import { ProtocolMessageMerkleRoot } from "../../../libs/fsp-utils/src/ProtocolMessageMerkleRoot";
import { encodeCommitPayloadMessage, encodeRevealPayloadMessage } from "./response-encoders";

enum ApiTagsEnum {
  PDP = "FTSO Protocol data provider",
  EXTERNAL = "External User Facing API",
}

@Controller("")
export class FtsoDataProviderController {
  private readonly logger = new Logger(FtsoDataProviderController.name);
  constructor(
    private readonly ftsoDataProviderService: FtsoDataProviderService,
    private readonly configService: ConfigService
  ) {}


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
    const data = await this.ftsoDataProviderService.getCommitData(votingRoundId, submitAddress);
    let encodedData = data ? encodeCommitPayloadMessage(data) : undefined;
    return {
      status: encodedData ? PDPResponseStatusEnum.OK : PDPResponseStatusEnum.NOT_AVAILABLE,
      data: encodedData
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
    const data = await this.ftsoDataProviderService.getRevealData(votingRoundId);
    let encodedData = data ? encodeRevealPayloadMessage(data) : undefined;
    return {
      status: encodedData ? PDPResponseStatusEnum.OK : PDPResponseStatusEnum.NOT_AVAILABLE,
      data: encodedData,
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
    const data = await this.ftsoDataProviderService.getResultData(votingRoundId);
    let encodedData = data ? ProtocolMessageMerkleRoot.encode(data) : undefined;
    return {
      status: data ? PDPResponseStatusEnum.OK : PDPResponseStatusEnum.NOT_AVAILABLE,
      data: encodedData,
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
