import { describe, expect, it, vi } from "vitest";

import {
  COSTON2_FDC_REGISTRY_NAMES,
  runCoston2FdcSmoke,
} from "../../src/fdc/coston2-fdc-smoke.js";

const ADDRESSES = {
  FdcHub: "0x1111111111111111111111111111111111111111",
  FdcRequestFeeConfigurations: "0x2222222222222222222222222222222222222222",
  FdcVerification: "0x3333333333333333333333333333333333333333",
  FlareSystemsManager: "0x4444444444444444444444444444444444444444",
  Relay: "0x5555555555555555555555555555555555555555",
} as const;

describe("runCoston2FdcSmoke", () => {
  it("resolves every FDC dependency through the Coston2 Contract Registry", async () => {
    const registry = {
      getContractAddressByName: vi.fn(
        async (name: keyof typeof ADDRESSES) => ADDRESSES[name],
      ),
    };

    await expect(runCoston2FdcSmoke(registry)).resolves.toEqual(ADDRESSES);
    expect(registry.getContractAddressByName).toHaveBeenCalledTimes(
      COSTON2_FDC_REGISTRY_NAMES.length,
    );
    for (const name of COSTON2_FDC_REGISTRY_NAMES) {
      expect(registry.getContractAddressByName).toHaveBeenCalledWith(name);
    }
  });

  it("rejects a missing registry dependency before a live request can be attempted", async () => {
    const registry = {
      getContractAddressByName: vi.fn(
        async () => "0x0000000000000000000000000000000000000000" as const,
      ),
    };

    await expect(runCoston2FdcSmoke(registry)).rejects.toThrow(
      "did not resolve",
    );
  });
});
