import { Test, TestingModule } from '@nestjs/testing';
import { FtsoCoreService } from './ftso-core.service';

describe('FtsoCoreService', () => {
  let service: FtsoCoreService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FtsoCoreService],
    }).compile();

    service = module.get<FtsoCoreService>(FtsoCoreService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
