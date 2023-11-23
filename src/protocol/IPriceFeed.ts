import { Feed } from "./voting-types";

export interface IPriceFeed {
  getPriceForEpoch(priceEpochId: number): number;
  getFeedInfo(): Feed;
}

export const priceFeedImplRegistry: Map<string, Function> = new Map();

export function PriceFeedImplFactory(
  target: Function,
  _propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<any>
) {
  priceFeedImplRegistry.set(target.name, descriptor.value);
}
