import { Controller, Get, InternalServerErrorException, Logger, Param, ParseIntPipe, UseGuards } from "@nestjs/common";
import { ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ProtocolMessageMerkleRoot } from "../../../libs/fsp-utils/src/ProtocolMessageMerkleRoot";
import { EPOCH_SETTINGS } from "../../../libs/ftso-core/src/configs/networks";
import { ApiKeyAuthGuard } from "./auth/apikey.guard";
import {
  AbiDefinitionsResponse,
  ExternalFeedWithProofResponse,
  ExternalMedianResponse,
  ExternalResponse,
  ExternalResponseStatusEnum,
  PDPResponse,
  PDPResponseStatusEnum,
} from "./dto/data-provider-responses.dto";
import { FtsoDataProviderService } from "./ftso-data-provider.service";
import { encodeCommitPayloadMessage, encodeRevealPayloadMessage } from "./response-encoders";

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
    if (isBeforeDeadline(votingRoundId)) {
      return {
        status: ExternalResponseStatusEnum.TOO_EARLY,
      };
    }
    const data = await this.ftsoDataProviderService.getFullMerkleTree(votingRoundId);
    return {
      status: data ? ExternalResponseStatusEnum.OK : ExternalResponseStatusEnum.NOT_AVAILABLE,
      ...data,
    };
  }

  @ApiTags(ApiTagsEnum.EXTERNAL)
  @Get("specific-feed/:feedId/:votingRoundId")
  async feedWithProof(
    @Param("feedId") feedId: string,
    @Param("votingRoundId", ParseIntPipe) votingRoundId: number
  ): Promise<ExternalFeedWithProofResponse> {
    if (isBeforeDeadline(votingRoundId)) {
      return {
        status: ExternalResponseStatusEnum.TOO_EARLY,
      };
    }
    const data = await this.ftsoDataProviderService.getFeedWithProof(votingRoundId, feedId);
    return {
      status: data ? ExternalResponseStatusEnum.OK : ExternalResponseStatusEnum.NOT_AVAILABLE,
      feedWithProof: data,
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
    if (isBeforeDeadline(votingRoundId)) {
      return {
        status: ExternalResponseStatusEnum.TOO_EARLY,
      };
    }
    const data = await this.ftsoDataProviderService.getFullMedianData(votingRoundId);
    return {
      status: data ? ExternalResponseStatusEnum.OK : ExternalResponseStatusEnum.NOT_AVAILABLE,
      votingRoundId,
      medianData: data,
    };
  }
}

function isBeforeDeadline(votingRoundId: number): boolean {
  const localTimeDriftOffset = 1000; // 1 second
  const now = Date.now();
  const revealDeadline = EPOCH_SETTINGS().revealDeadlineSec(votingRoundId + 1) * 1000;
  return now > revealDeadline + localTimeDriftOffset;
}
