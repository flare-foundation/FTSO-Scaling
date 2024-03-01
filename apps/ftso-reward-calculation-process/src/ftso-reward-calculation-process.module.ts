import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import configuration, { IConfig } from "./config/configuration";

import { FtsoRewardCalculationProcessCommand } from "./commands/ftso-reward-calculator-process.command";
import { TLPEvents, TLPState, TLPTransaction } from "../../../libs/ftso-core/src/orm/entities";
import { CalculatorService } from "./services/calculator.service";

const IMPORTS_ARRAY = [
  ConfigModule.forRoot({
    load: [configuration],
  }),
  TypeOrmModule.forRootAsync({
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: async (configService: ConfigService<IConfig>) => {
      const sqliteDatabase = configService.get("db_sqlite3_path");
      if (sqliteDatabase) {
        return {
          type: "sqlite",
          database: sqliteDatabase,
          entities: [TLPTransaction, TLPEvents, TLPState],
          synchronize: false,
          flags: 1,
          // logging: true,
        };
      }
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
  controllers: [],
  providers: [FtsoRewardCalculationProcessCommand, CalculatorService],
})
export class FtsoRewardCalculationProcessModule {}
