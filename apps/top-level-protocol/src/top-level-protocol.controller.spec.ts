import { Test, TestingModule } from '@nestjs/testing';
import { TopLevelProtocolController } from './top-level-protocol.controller';
import { TopLevelProtocolService } from './top-level-protocol.service';

describe('TopLevelProtocolController', () => {
  let topLevelProtocolController: TopLevelProtocolController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [TopLevelProtocolController],
      providers: [TopLevelProtocolService],
    }).compile();

    topLevelProtocolController = app.get<TopLevelProtocolController>(TopLevelProtocolController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(topLevelProtocolController.getHello()).toBe('Hello World!');
    });
  });
});
