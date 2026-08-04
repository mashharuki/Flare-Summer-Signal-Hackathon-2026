import type { Address } from "viem";

export const COSTON2_FDC_REGISTRY_NAMES = [
  "FdcHub",
  "FdcRequestFeeConfigurations",
  "FdcVerification",
  "FlareSystemsManager",
  "Relay",
] as const;

export type Coston2FdcRegistryName =
  (typeof COSTON2_FDC_REGISTRY_NAMES)[number];

export interface Coston2FdcRegistryReader {
  getContractAddressByName(name: Coston2FdcRegistryName): Promise<Address>;
}

export interface Coston2FdcDependencies {
  readonly FdcHub: Address;
  readonly FdcRequestFeeConfigurations: Address;
  readonly FdcVerification: Address;
  readonly FlareSystemsManager: Address;
  readonly Relay: Address;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Read-only Coston2 smoke boundary. It confirms that every contract required
 * by the FDC coordinator is currently resolvable from the Contract Registry.
 */
export async function runCoston2FdcSmoke(
  registry: Coston2FdcRegistryReader,
): Promise<Coston2FdcDependencies> {
  const addresses = await Promise.all(
    COSTON2_FDC_REGISTRY_NAMES.map(async (name) => {
      const address = await registry.getContractAddressByName(name);
      if (address.toLowerCase() === ZERO_ADDRESS) {
        throw new Error(`Coston2 Contract Registry did not resolve ${name}.`);
      }
      return [name, address] as const;
    }),
  );
  const resolved = Object.fromEntries(addresses) as Record<
    Coston2FdcRegistryName,
    Address
  >;
  return {
    FdcHub: resolved.FdcHub,
    FdcRequestFeeConfigurations: resolved.FdcRequestFeeConfigurations,
    FdcVerification: resolved.FdcVerification,
    FlareSystemsManager: resolved.FlareSystemsManager,
    Relay: resolved.Relay,
  };
}
