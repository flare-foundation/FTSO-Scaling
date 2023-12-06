import { NestFactory } from "@nestjs/core";
import { FtsoFinalizerModule } from "./ftso-finalizer.module";
import { FtsoFinalizerService } from "./ftso-finalizer.service";

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(FtsoFinalizerModule);
  const finalizer = app.get(FtsoFinalizerService);
  await finalizer.run();
}
bootstrap();
