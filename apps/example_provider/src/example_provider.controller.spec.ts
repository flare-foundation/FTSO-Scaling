import { Test, TestingModule } from '@nestjs/testing';
import { ExampleProviderController } from './example_provider.controller';
import { ExampleProviderService } from './example_provider.service';

describe('ExampleProviderController', () => {
  let exampleProviderController: ExampleProviderController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [ExampleProviderController],
      providers: [ExampleProviderService],
    }).compile();

    exampleProviderController = app.get<ExampleProviderController>(ExampleProviderController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(exampleProviderController.getHello()).toBe('Hello World!');
    });
  });
});
