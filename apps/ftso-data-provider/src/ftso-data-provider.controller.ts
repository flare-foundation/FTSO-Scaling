import { Controller, Get, InternalServerErrorException, Logger, Param, ParseIntPipe, UseGuards } from "@nestjs/common";
import { ApiSecurity, ApiTags } from "@nestjs/swagger";
import {
  AbiDefinitionsResponse,
  ExternalMedianResponse,
  ExternalResponse,
  ExternalResponseStatusEnum,
  PDPResponse,
  PDPResponseStatusEnum,
} from "./dto/data-provider-responses.dto";
import { FtsoDataProviderService } from "./ftso-data-provider.service";
import { ProtocolMessageMerkleRoot } from "../../../libs/fsp-utils/src/ProtocolMessageMerkleRoot";
import { encodeCommitPayloadMessage, encodeRevealPayloadMessage } from "./response-encoders";
import { ApiKeyAuthGuard } from "./auth/apikey.guard";

enum ApiTagsEnum {
  PDP = "FTSO Protocol data provider",
  EXTERNAL = "External User Facing API",
}

@Controller("")
@UseGuards(ApiKeyAuthGuard)
@ApiSecurity("X-API-KEY")
export class FtsoDataProviderController {
  private readonly logger = new Logger(FtsoDataProviderController.name);
  constructor(private readonly ftsoDataProviderService: FtsoDataProviderService) {}

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
    const encodedData = data ? encodeCommitPayloadMessage(data) : undefined;
    this.logger.log(`Returning commit data for voting round ${votingRoundId}: `);
    return {
      status: encodedData ? PDPResponseStatusEnum.OK : PDPResponseStatusEnum.NOT_AVAILABLE,
      data: encodedData,
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
    const data = await this.ftsoDataProviderService.getRevealData(votingRoundId, submitAddress);
    const encodedData = data ? encodeRevealPayloadMessage(data) : undefined;
    this.logger.log(`Returning reveal data for voting round ${votingRoundId}`);
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
    const encodedData = data ? ProtocolMessageMerkleRoot.encode(data) : undefined;
    this.logger.log(`Returning result data for voting round ${votingRoundId}`);
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
  @Get("data/:votingRoundId")
  async merkleTree(@Param("votingRoundId", ParseIntPipe) votingRoundId: number): Promise<ExternalResponse> {
    // TODO: handle to early response as it is more informative, for now we respond with not available for to early cases
    const data = await this.ftsoDataProviderService.getFullMerkleTree(votingRoundId);
    return {
      status: data ? ExternalResponseStatusEnum.OK : ExternalResponseStatusEnum.NOT_AVAILABLE,
      ...data,
    };
  }

  @ApiTags(ApiTagsEnum.EXTERNAL)
  @Get("data-abis")
  async treeAbis(): Promise<AbiDefinitionsResponse> {
    const data = this.ftsoDataProviderService.getAbiDefinitions();
    return {
      status: ExternalResponseStatusEnum.OK,
      data,
    };
  }

  @ApiTags(ApiTagsEnum.EXTERNAL)
  @Get("medianCalculationResults/:votingRoundId")
  async fullMedianData(@Param("votingRoundId", ParseIntPipe) votingRoundId: number): Promise<ExternalMedianResponse> {
    // TODO: handle to early response as it is more informative, for now we respond with not available for to early cases
    const data = await this.ftsoDataProviderService.getFullMedianData(votingRoundId);
    return {
      status: data ? ExternalResponseStatusEnum.OK : ExternalResponseStatusEnum.NOT_AVAILABLE,
      votingRoundId,
      medianData: data,
    };
  }
}
