import { Feed } from "./voting-types";

export interface IPriceProvider {
  readonly feed: Feed;

  getCurrentPrice(): number;
}

export const priceProviderImplRegistry: Map<string, Function> = new Map();

export function PriceProviderImplFactory(
  target: Function,
  _propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<any>
) {
  console.log("Setting factory");
  priceProviderImplRegistry.set(target.name, descriptor.value);
}
