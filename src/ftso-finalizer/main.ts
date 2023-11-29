import { NestFactory } from '@nestjs/core';
import { FtsoFinalizerModule } from './ftso-finalizer.module';

async function bootstrap() {
  const appContext = await NestFactory.createApplicationContext(FtsoFinalizerModule);
  const appService = appContext.get(FtsoFinalizerModule);
  appService.run();
  await appContext.close();
}
bootstrap();