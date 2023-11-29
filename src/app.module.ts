import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration, { IConfig } from './config/configuration';
import { TLPEvents, TLPTransaction } from './orm/entities';
import { TopLevelClientModule } from './top-level-client/top-level-client.module';

const IMPORTS_ARRAY = [
  ConfigModule.forRoot({
    load: [configuration],
  }),
  TypeOrmModule.forRootAsync({
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: async (configService: ConfigService<IConfig>) => {
      return {
        type: 'mysql',
        host: configService.getOrThrow('db_host'),
        port: configService.getOrThrow('db_port'),
        username: configService.getOrThrow('db_user'),
        password: configService.getOrThrow('db_pass'),
        database: configService.getOrThrow('db_name'),
        entities: [TLPTransaction, TLPEvents],
        synchronize: false,
      };
    },
  }),
];

@Module({
  imports: IMPORTS_ARRAY,
  controllers: [
    
  ],
  providers: [

  ],
})
export class AllAppsModule {}

@Module({
  imports: IMPORTS_ARRAY,
  controllers: [FtsoRewardController],
  providers: [FtsoRewardingService],
})
export class FtsoAppModule {}

@Module({
  imports: IMPORTS_ARRAY,
  controllers: [FlareDataConnectorRewardController],
  providers: [FlareDataConnectorRewardingService],
})
export class FdcAppModule {}

@Module({
  imports: IMPORTS_ARRAY,
  controllers: [FastUpdatesRewardController],
  providers: [FastUpdatesRewardingService],
})
export class FastUpdatesAppModule {}

@Module({
  imports: IMPORTS_ARRAY,
  controllers: [StakingRewardController],
  providers: [StakingRewardingService],
})
export class StakingAppModule {}
