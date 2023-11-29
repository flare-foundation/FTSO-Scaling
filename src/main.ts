import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import {
  AllAppsModule,
  FastUpdatesAppModule,
  FdcAppModule,
  FtsoAppModule,
  StakingAppModule,
} from './app.module';

function getModuleClass(): any {
  switch (process.env.PROTOCOL_BUILD_APP.toLowerCase()) {
    case 'all':
      return AllAppsModule;
    case 'ftso':
      return FtsoAppModule;
    case 'fdc':
      return FdcAppModule;
    case 'staking':
      return StakingAppModule;
    case 'ffu':
      return FastUpdatesAppModule;
    default:
      throw new Error(
        `Wrong protocol name: '${process.env.PROTOCOL_BUILD_APP}'`,
      );
  }
}

async function bootstrap() {
  const module = getModuleClass();
  const app = await NestFactory.create(module);
  app.use(helmet());
  const basePath = process.env.APP_BASE_PATH ?? '';

  const config = new DocumentBuilder()
    .setTitle('Flare rewarding client server')
    .setDescription(
      'This server is used to query the calculation logic for each protocol',
    )
    .setBasePath(basePath)
    // .addApiKey({ type: 'apiKey', name: 'X-API-KEY', in: 'header' }, 'X-API-KEY')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${basePath}/api-doc`, app, document);

  app.setGlobalPrefix(basePath);

  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  console.log(`Your project is available on PORT: ${PORT}`);
  await app.listen(PORT);
}
bootstrap();
