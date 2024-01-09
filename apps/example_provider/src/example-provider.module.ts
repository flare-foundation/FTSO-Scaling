import { Module } from "@nestjs/common";
import { ExampleProviderController } from "./example-provider.controller";
import { RandomProviderService } from "./services/random-provider-service";

@Module({
  imports: [],
  controllers: [ExampleProviderController],
  providers: [RandomProviderService],
})
export class ExampleProviderModule {}
