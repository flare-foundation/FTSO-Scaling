import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TLPEvents, TLPState, TLPTransaction } from "../../../libs/ftso-core/src/orm/entities";
import configuration, { IConfig } from "./config/configuration";
import { FtsoCalculatorController } from "./ftso-calculator.controller";
import { FtsoCalculatorService } from "./ftso-calculator.service";

const IMPORTS_ARRAY = [
  ConfigModule.forRoot({
    load: [configuration],
  }),
  TypeOrmModule.forRootAsync({
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: async (configService: ConfigService<IConfig>) => {
      // return {
      //   type: 'sqlite',
      //   database: '/Users/work/Code/flare-smart-contracts-v2/db/indexer.db',
      //   entities: [TLPTransaction, TLPEvents, TLPState],
      //   synchronize: false,
      // };
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
  controllers: [FtsoCalculatorController],
  providers: [FtsoCalculatorService],
})
export class FtsoCalculatorModule {}
