import { NestFactory } from '@nestjs/core';
import { TopLevelProtocolModule } from './top-level-protocol.module';

async function bootstrap() {
  const app = await NestFactory.create(TopLevelProtocolModule);
  await app.listen(3000);
}
bootstrap();
