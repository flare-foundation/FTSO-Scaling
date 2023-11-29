import { Feed } from "./voting-types";

export interface IPriceProvider {
  getPriceForEpoch(priceEpochId: number): number;
  getFeedInfo(): Feed;
}

export const priceProviderImplRegistry: Map<string, Function> = new Map();

export function PriceProviderImplFactory(
  target: Function,
  _propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<any>
) {
  priceProviderImplRegistry.set(target.name, descriptor.value);
}
