import { NestFactory } from "@nestjs/core";
import { RandomExampleProviderModule } from "./example-provider.module";
import { DocumentBuilder, SwaggerDocumentOptions, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";

async function bootstrap() {
  const app = await NestFactory.create(RandomExampleProviderModule);
  app.use(helmet());
  // TODO: consider adding cors protectors + some sort of api key protection
  const basePath = process.env.PRICE_PROVIDER_CLIENT_BASE_PATH ?? "";

  const config = new DocumentBuilder()
    .setTitle("Simple Pricer Provider API interface")
    .setDescription("This server is used by the FTSO protocol data provider.")
    .setBasePath(basePath)
    // .addApiKey({ type: 'apiKey', name: 'X-API-KEY', in: 'header' }, 'X-API-KEY')
    .setVersion("1.0")
    .build();
  const options: SwaggerDocumentOptions = {
    operationIdFactory: (controllerKey: string, methodKey: string) => methodKey,
  };
  const document = SwaggerModule.createDocument(app, config, options);
  SwaggerModule.setup(`${basePath}/api-doc`, app, document);

  app.setGlobalPrefix(basePath);

  const PORT = process.env.PRICE_PROVIDER_CLIENT_PORT ? parseInt(process.env.PRICE_PROVIDER_CLIENT_PORT) : 3101;
  console.log(`Your example price provider for FTSO is available on PORT: ${PORT}`);
  console.log(`Open link: http://localhost:${PORT}/api-doc`);
  await app.listen(PORT);
}
bootstrap();
