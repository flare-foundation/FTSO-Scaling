import { Module } from "@nestjs/common";
import { FtsoFinalizerService } from "./ftso-finalizer.service";

@Module({
  imports: [],
  providers: [FtsoFinalizerService],
})
export class FtsoFinalizerModule {}
