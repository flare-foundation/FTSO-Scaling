import { Controller, Get } from '@nestjs/common';
import { ExampleProviderService } from './example_provider.service';

@Controller()
export class ExampleProviderController {
  constructor(private readonly exampleProviderService: ExampleProviderService) {}

  @Get()
  getHello(): string {
    return this.exampleProviderService.getHello();
  }
}
