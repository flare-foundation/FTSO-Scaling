import { Controller, Get } from '@nestjs/common';
import { TopLevelProtocolService } from './top-level-protocol.service';

@Controller()
export class TopLevelProtocolController {
  constructor(private readonly topLevelProtocolService: TopLevelProtocolService) {}

  @Get()
  getHello(): string {
    return this.topLevelProtocolService.getHello();
  }
}
