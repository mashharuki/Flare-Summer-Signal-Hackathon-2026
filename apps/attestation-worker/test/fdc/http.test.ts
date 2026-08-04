import { describe, expect, it, vi } from "vitest";

import { fetchJson, normalizeHttpsBaseUrl } from "./../../src/fdc/http.js";

describe("normalizeHttpsBaseUrl", () => {
  it("accepts a verifier origin and removes its trailing slash", () => {
    expect(
      normalizeHttpsBaseUrl(
        "FDC_VERIFIER_URL_TESTNET",
        "https://fdc-verifiers-testnet.flare.network/",
      ),
    ).toBe("https://fdc-verifiers-testnet.flare.network");
  });

  it("rejects a Swagger or endpoint URL used as a service base URL", () => {
    expect(() =>
      normalizeHttpsBaseUrl(
        "FDC_VERIFIER_URL_TESTNET",
        "https://fdc-verifiers-testnet.flare.network/verifier/xrp/api-doc",
      ),
    ).toThrow("must be an HTTPS origin without a path");
  });
});

describe("fetchJson", () => {
  it("preserves the connection cause when no HTTP response is received", async () => {
    const fetcher = vi.fn().mockRejectedValue(
      new TypeError("fetch failed", {
        cause: new Error(
          "getaddrinfo ENOTFOUND fdc-verifiers-testnet.flare.network",
        ),
      }),
    );

    await expect(
      fetchJson(
        "FDC Verifier",
        "https://fdc-verifiers-testnet.flare.network",
        {},
        fetcher,
      ),
    ).rejects.toThrow("getaddrinfo ENOTFOUND");
  });

  it("preserves an HTTP status so retryable DA responses can be handled safely", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 400 }));

    await expect(
      fetchJson(
        "FDC DA Layer",
        "https://ctn2-data-availability.flare.network",
        {},
        fetcher,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
