import { Module } from "@nestjs/common";
import { FtsoCalculatorController } from "./ftso-calculator.controller";
import { FtsoCalculatorService } from "./ftso-calculator.service";
import configuration, { IConfig } from "./config/configuration";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { FTSOParameters, FeedConfig } from "./config/FTSOParameters";
import { PriceService } from "./price-feeds/price.service";
import { IPriceProvider } from "../../../libs/ftso-core/src/IPriceFeed";
import { CcxtPriceFeed } from "./price-feeds/CcxtPriceFeed";
import { RandomPriceFeed } from "./price-feeds/RandomPriceFeed";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TLPTransaction, TLPEvents, TLPState } from "../../../libs/ftso-core/src/orm/entities";

async function getPriceFeeds(feedConfigs: FeedConfig[]) {
  return Promise.all(
    feedConfigs.map(async (config, index) => {
      let provider: IPriceProvider;
      // TODO: Instantiate price provider dynamiocally
      if (config.providerImpl == "CcxtPriceFeed") {
        provider = await CcxtPriceFeed.create(config);
      } else {
        provider = new RandomPriceFeed(config.symbol, index);
      }
      return provider;
    })
  );
}

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

const priceServiceFactory = {
  provide: "PRICE_SERVICE",
  useFactory: async (config: ConfigService) => {
    const params = config.get<FTSOParameters>("params");
    const feeds = await getPriceFeeds(params.feeds);
    return new PriceService(feeds);
  },
  inject: [ConfigService],
};

@Module({
  imports: IMPORTS_ARRAY,
  controllers: [FtsoCalculatorController],
  providers: [FtsoCalculatorService, priceServiceFactory],
})
export class FtsoCalculatorModule {}
