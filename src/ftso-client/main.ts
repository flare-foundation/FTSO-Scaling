import { NestFactory } from '@nestjs/core';
import { FtsoClientModule } from './ftso-client.module';
import { FtsoClientService } from './ftso-client.service';

async function bootstrap() {
  const appContext = await NestFactory.createApplicationContext(FtsoClientModule);
  const appService = appContext.get(FtsoClientService);
  await appService.run();
  
}
bootstrap();