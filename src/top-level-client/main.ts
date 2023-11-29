import { NestFactory } from '@nestjs/core';
import { TopLevelClientModule } from './top-level-client.module';
import { TopLevelClientService } from './top-level-client.service';

async function bootstrap() {
  const appContext = await NestFactory.createApplicationContext(TopLevelClientModule);
  const appService = appContext.get(TopLevelClientService);
  appService.run();
  // await appContext.close();
}
bootstrap();