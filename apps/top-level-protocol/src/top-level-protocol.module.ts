import { Module } from '@nestjs/common';
import { TopLevelProtocolController } from './top-level-protocol.controller';
import { TopLevelProtocolService } from './top-level-protocol.service';

@Module({
  imports: [],
  controllers: [TopLevelProtocolController],
  providers: [TopLevelProtocolService],
})
export class TopLevelProtocolModule {}
