import { Test, TestingModule } from '@nestjs/testing';
import { FtsoFinalizerController } from './ftso-finalizer.controller';
import { FtsoFinalizerService } from './ftso-finalizer.service';

describe('FtsoFinalizerController', () => {
  let ftsoFinalizerController: FtsoFinalizerController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [FtsoFinalizerController],
      providers: [FtsoFinalizerService],
    }).compile();

    ftsoFinalizerController = app.get<FtsoFinalizerController>(FtsoFinalizerController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(ftsoFinalizerController.getHello()).toBe('Hello World!');
    });
  });
});
