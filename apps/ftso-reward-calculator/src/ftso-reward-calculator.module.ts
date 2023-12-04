import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import configuration, { IConfig } from "./config/configuration";

import { FtsoRewardingService } from "./protocol-services/ftso/ftso-reward.service";
import { FtsoRewardController } from "./controllers/ftso/ftso-reward.controller";
import { TLPEvents, TLPState, TLPTransaction } from "../../../libs/ftso-core/src/orm/entities";

const IMPORTS_ARRAY = [
  ConfigModule.forRoot({
    load: [configuration],
  }),
  TypeOrmModule.forRootAsync({
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: async (configService: ConfigService<IConfig>) => {
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
];

@Module({
  imports: IMPORTS_ARRAY,
  controllers: [FtsoRewardController],
  providers: [FtsoRewardingService],
})
export class FtsoRewardCalculatorModule {}
