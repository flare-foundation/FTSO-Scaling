import { NestFactory } from '@nestjs/core';
import { FtsoCalculatorModule } from './ftso-calculator.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(FtsoCalculatorModule);
  // TODO: consider adding helmet and cors protectors + some sort of api key protection
  const basePath = process.env.DATA_PROVIDER_CLIENT_BASE_PATH ?? '';

  const config = new DocumentBuilder()
    .setTitle('Flare Time Series Oracle Calculator API interface')
    .setDescription(
      'This server is used by the Flare Protocol client and therefore implements the default api endpoints to facilitate Flare Time Series Oracle (FTSO) protocol. It also adds the support for querying the finalized median merkle trees',
    )
    .setBasePath(basePath)
    // .addApiKey({ type: 'apiKey', name: 'X-API-KEY', in: 'header' }, 'X-API-KEY')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${basePath}/api-doc`, app, document);

  app.setGlobalPrefix(basePath);

  const PORT = process.env.DATA_PROVIDER_CLIENT_PORT ? parseInt(process.env.DATA_PROVIDER_CLIENT_PORT) : 3100;
  console.log(`Your instance of FTSO protocol data provider is available on PORT: ${PORT}`);
  console.log(`Open link: http://localhost:${PORT}/api-doc`)
  await app.listen(PORT);
}
bootstrap();
