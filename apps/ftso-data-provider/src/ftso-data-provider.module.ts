import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TLPEvents, TLPState, TLPTransaction } from "../../../libs/ftso-core/src/orm/entities";
import configuration, { IConfig } from "./config/configuration";
import { FtsoDataProviderController } from "./ftso-data-provider.controller";
import { FtsoDataProviderService } from "./ftso-data-provider.service";
import { AuthService } from "./auth/auth.service";
import { AuthModule } from "./auth/auth.module";
import { ApiKeyStrategy } from "./auth/apikey.strategy";

const IMPORTS_ARRAY = [
  ConfigModule.forRoot({
    load: [configuration],
  }),
  TypeOrmModule.forRootAsync({
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: (configService: ConfigService<IConfig>) => {
      return {
        type: "mysql",
        host: configService.getOrThrow("db_host"),
        port: configService.getOrThrow("db_port"),
        username: configService.getOrThrow("db_user"),
        password: configService.getOrThrow("db_pass"),
        database: configService.getOrThrow("db_name"),
        entities: [TLPTransaction, TLPEvents, TLPState],
        synchronize: false,
      };
    },
  }),
  AuthModule,
];

@Module({
  imports: IMPORTS_ARRAY,
  controllers: [FtsoDataProviderController],
  providers: [ApiKeyStrategy, AuthService, FtsoDataProviderService],
})
export class FtsoDataProviderModule {}
