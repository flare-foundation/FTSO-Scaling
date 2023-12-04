import { NestFactory } from '@nestjs/core';
import { FtsoFinalizerModule } from './ftso-finalizer.module';

async function bootstrap() {
  const app = await NestFactory.create(FtsoFinalizerModule);
  await app.listen(3000);
}
bootstrap();
