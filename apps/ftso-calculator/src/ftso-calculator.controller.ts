import {
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { errorString } from "../../../libs/ftso-core/src/utils/error";
import { ExternalResponse, PDPResponse, PDPResponseStatusEnum } from "./dto/data-provider-responses.dto";
import { FtsoCalculatorService } from "./ftso-calculator.service";
import { IPayloadMessage, PayloadMessage } from "../../../libs/ftso-core/src/utils/PayloadMessage";
import { FTSO2_PROTOCOL_ID } from "../../../libs/ftso-core/src/utils/EncodingUtils";

enum ApiTagsEnum {
  PDP = "FTSO Protocol data provider",
  EXTERNAL = "External User Facing API",
}

@Controller("")
export class FtsoCalculatorController {
  private readonly logger = new Logger(FtsoCalculatorController.name);
  constructor(private readonly ftsoCalculatorService: FtsoCalculatorService) {}

  // Protocol Data Provider APIs

  @ApiTags(ApiTagsEnum.PDP)
  @Get("submit1/:votingRoundId")
  async submit1(
    @Param("votingRoundId", ParseIntPipe) votingRoundId: number,
    @Query("signingAddress") signingAddress: string
  ): Promise<PDPResponse> {
    this.logger.log(
      `Calling GET on submit1 with param: votingRoundId ${votingRoundId} and query param: signingAddress ${signingAddress}`
    );
    return {
      status: PDPResponseStatusEnum.OK,
      data: await this.getCommitMessage(votingRoundId, signingAddress),
      additionalData: "",
    };
  }

  @ApiTags(ApiTagsEnum.PDP)
  @Get("submit2/:votingRoundId")
  async submit2(
    @Param("votingRoundId", ParseIntPipe) votingRoundId: number,
    @Query("signingAddress") signingAddress: string
  ): Promise<PDPResponse> {
    this.logger.log(
      `Calling GET on submit2 with param: votingRoundId ${votingRoundId} and query param: signingAddress ${signingAddress}`
    );
    return {
      status: PDPResponseStatusEnum.OK,
      data: await this.getReveal(votingRoundId),
      additionalData: "",
    };
  }

  @ApiTags(ApiTagsEnum.PDP)
  @Get("submitSignatures/:votingRoundId")
  async submitSignatures(
    @Param("votingRoundId", ParseIntPipe) votingRoundId: number,
    @Query("signingAddress") signingAddress: string
  ): Promise<PDPResponse> {
    this.logger.log(
      `Calling GET on submitSignatures with param: votingRoundId ${votingRoundId} and query param: signingAddress ${signingAddress}`
    );
    return {
      status: PDPResponseStatusEnum.OK,
      data: await this.getResult(votingRoundId),
      additionalData: "",
    };
  }

  @ApiTags(ApiTagsEnum.PDP)
  @Get("submit3/:votingRoundId")
  async submit3(
    @Param("votingRoundId", ParseIntPipe) votingRoundId: number,
    @Query("signingAddress") signingAddress: string
  ): Promise<PDPResponse> {
    this.logger.log(
      `Calling GET on submit3 with param: votingRoundId ${votingRoundId} and query param: signingAddress ${signingAddress}`
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

  ////////////////////////////
  // FTOSv2 protocol logic

  async getCommitMessage(votingRoundId: number, signingAddress: string): Promise<string> {
    this.logger.log(`Getting commit for epoch ${votingRoundId}`);
    const commit = await this.ftsoCalculatorService.getCommit(votingRoundId, signingAddress);
    const msg: IPayloadMessage<string> = {
      protocolId: FTSO2_PROTOCOL_ID,
      votingRoundId: votingRoundId,
      payload: commit,
    };
    return PayloadMessage.encode(msg);
  }

  async getReveal(votingRoundId: number): Promise<string> {
    this.logger.log(`Getting reveal for epoch ${votingRoundId}`);
    const reveal = await this.ftsoCalculatorService.getReveal(votingRoundId);
    this.logger.log(`Reveal from service ${votingRoundId}: ${JSON.stringify(reveal)}`);
    if (reveal === undefined) {
      throw new NotFoundException(`Reveal for epoch ${votingRoundId} not found`);
    }

    const serializedReveal = reveal.random.toString() + reveal.encodedPrices.slice(2);
    this.logger.log(`Reveal for epoch ${votingRoundId}: ${serializedReveal}`);

    const msg: IPayloadMessage<string> = {
      protocolId: FTSO2_PROTOCOL_ID,
      votingRoundId: votingRoundId,
      payload: serializedReveal,
    };
    return PayloadMessage.encode(msg);
  }

  async getResult(votingRoundId: number): Promise<string> {
    this.logger.log(`Getting result for epoch ${votingRoundId}`);
    try {
      const [merkleRoot, goodRandom] = await this.ftsoCalculatorService.getResult(votingRoundId);
      const encoded = // 38 bytes total
        "0x" +
        FTSO2_PROTOCOL_ID.toString(16).padStart(2, "0") + // 2 bytes
        votingRoundId.toString(16).padStart(8, "0") + // 4 bytes
        (goodRandom ? "01" : "00") + // 1 byte
        merkleRoot.toString().slice(2); // 32 bytes

      this.logger.log(`Result for epoch ${votingRoundId}: ${encoded}`);
      return encoded;
    } catch (e) {
      this.logger.error(`Error calculating result: ${errorString(e)}`);
      throw new InternalServerErrorException(`Unable to calculate result for epoch ${votingRoundId}`, { cause: e });
    }
  }
}
