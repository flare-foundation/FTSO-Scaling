import { Module } from '@nestjs/common';
import { FtsoProtocolService } from './ftso-protocol.service';

@Module({
  providers: [FtsoProtocolService],
  exports: [FtsoProtocolService],
})
export class FtsoProtocolModule {
  
}
