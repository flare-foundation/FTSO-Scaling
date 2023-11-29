import { Module } from "@nestjs/common";
import { TopLevelClientService } from "./top-level-client.service";

@Module({
  providers: [TopLevelClientService],
})
export class TopLevelClientModule {}
