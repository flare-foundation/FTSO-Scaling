import { Module } from '@nestjs/common';
import { ExampleProviderController } from './example_provider.controller';
import { ExampleProviderService } from './example_provider.service';

@Module({
  imports: [],
  controllers: [ExampleProviderController],
  providers: [ExampleProviderService],
})
export class ExampleProviderModule {}
