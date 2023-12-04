import { Module } from '@nestjs/common';
import { FtsoFinalizerController } from './ftso-finalizer.controller';
import { FtsoFinalizerService } from './ftso-finalizer.service';

@Module({
  imports: [],
  controllers: [FtsoFinalizerController],
  providers: [FtsoFinalizerService],
})
export class FtsoFinalizerModule {}
