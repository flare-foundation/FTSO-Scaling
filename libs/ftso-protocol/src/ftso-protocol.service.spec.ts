import { Test, TestingModule } from '@nestjs/testing';
import { FtsoProtocolService } from './ftso-protocol.service';

describe('FtsoProtocolService', () => {
  let service: FtsoProtocolService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FtsoProtocolService],
    }).compile();

    service = module.get<FtsoProtocolService>(FtsoProtocolService);
  });

  // it('should be defined', () => {
  //   expect(service).toBeDefined();
  // });
});
