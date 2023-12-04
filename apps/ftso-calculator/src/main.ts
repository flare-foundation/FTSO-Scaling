import { NestFactory } from '@nestjs/core';
import { FtsoCalculatorModule } from './ftso-calculator.module';

async function bootstrap() {
  const app = await NestFactory.create(FtsoCalculatorModule);
  await app.listen(3000);
}
bootstrap();
