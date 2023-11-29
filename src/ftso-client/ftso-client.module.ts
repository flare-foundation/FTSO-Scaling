import { Module } from "@nestjs/common";
import { FtsoClientService } from "./ftso-client.service";

@Module({ providers: [FtsoClientService] })
export class FtsoClientModule {}
