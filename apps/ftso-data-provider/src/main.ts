import { NestFactory } from "@nestjs/core";
import { FtsoDataProviderModule } from "./ftso-data-provider.module";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { LogLevel, Logger } from "@nestjs/common";
import { BigIntInterceptor } from "./utils/BigIntInterceptor";

async function bootstrap() {
  let logLevels: LogLevel[] = ["log"];
  if (process.env.LOG_LEVEL === "debug") {
    logLevels = ["verbose"];
  }

  const app = await NestFactory.create(FtsoDataProviderModule, { logger: logLevels });
  app.enableShutdownHooks();
  app.useGlobalInterceptors(new BigIntInterceptor());
  app.use(helmet());
  const basePath = process.env.DATA_PROVIDER_CLIENT_BASE_PATH ?? "";

  const config = new DocumentBuilder()
    .setTitle("Flare Time Series Oracle Calculator API interface")
    .setDescription(
      "This server is used by the Flare Protocol client and therefore implements the default api endpoints to facilitate Flare Time Series Oracle (FTSO) protocol. It also adds the support for querying the finalized median merkle trees"
    )
    .addApiKey({ type: "apiKey", name: "X-API-KEY", in: "header" }, "X-API-KEY")
    .setBasePath(basePath)
    .setVersion("1.0")
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${basePath}/api-doc`, app, document);

  app.setGlobalPrefix(basePath);

  const PORT = process.env.DATA_PROVIDER_CLIENT_PORT ? parseInt(process.env.DATA_PROVIDER_CLIENT_PORT) : 3100;
  const logger = new Logger();
  logger.log(`Your instance of FTSO protocol data provider is available on PORT: ${PORT}`);
  logger.log(`Open link: http://localhost:${PORT}/api-doc`);
  await app.listen(PORT);
}

void bootstrap();
