import { Module } from '@nestjs/common';
import { FtsoCoreService } from './ftso-core.service';

@Module({
  providers: [FtsoCoreService],
  exports: [FtsoCoreService],
})
export class FtsoCoreModule {}
