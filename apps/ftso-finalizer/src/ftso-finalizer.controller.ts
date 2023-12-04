import { Controller, Get } from '@nestjs/common';
import { FtsoFinalizerService } from './ftso-finalizer.service';

@Controller()
export class FtsoFinalizerController {
  constructor(private readonly ftsoFinalizerService: FtsoFinalizerService) {}

  @Get()
  getHello(): string {
    return this.ftsoFinalizerService.getHello();
  }
}
