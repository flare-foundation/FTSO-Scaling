import { NestFactory } from '@nestjs/core';
import { FtsoRewardCalculatorModule } from './ftso-reward-calculator.module';

async function bootstrap() {
  const app = await NestFactory.create(FtsoRewardCalculatorModule);
  await app.listen(3000);
}
bootstrap();
