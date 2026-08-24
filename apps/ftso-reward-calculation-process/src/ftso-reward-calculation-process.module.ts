import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import configuration, { IConfig } from "./config/configuration";

import { TLPEvents, TLPState, TLPTransaction } from "../../../libs/ftso-core/src/orm/entities";
import { FtsoRewardCalculationProcessCommand } from "./commands/ftso-reward-calculator-process.command";
import { CalculatorService } from "./services/calculator.service";

const IMPORTS_ARRAY = [
  ConfigModule.forRoot({
    load: [configuration],
  }),
  TypeOrmModule.forRootAsync({
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: (configService: ConfigService<IConfig>) => {
      const sqliteDatabase: string = configService.get("db_sqlite3_path");
      if (sqliteDatabase) {
        return {
          type: "better-sqlite3",
          database: sqliteDatabase,
          entities: [TLPTransaction, TLPEvents, TLPState],
          synchronize: false,
          readonly: true,
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
        // Each worker thread builds its own pool, so the connections a run can
        // hold at once is this times the number of workers. The driver default
        // of 10 puts a modestly parallel run over a stock server's 151.
        extra: {
          connectionLimit: configService.getOrThrow<number>("db_connection_limit"),
        },
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
