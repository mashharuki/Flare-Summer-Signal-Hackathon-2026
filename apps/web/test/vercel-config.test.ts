import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Vercel deployment configuration", () => {
  it("builds the web workspace from the monorepo root", async () => {
    const config = JSON.parse(
      await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;

    expect(config.framework).toBe("nextjs");
    expect(config.installCommand).toBe(
      "cd ../.. && pnpm install --frozen-lockfile",
    );
    expect(config.buildCommand).toBe(
      "cd ../.. && pnpm --filter @reserveflow/web build",
    );
  });

  it("provides a safe browser-only local environment template", async () => {
    const environment = await readFile(
      new URL("../.env.local.example", import.meta.url),
      "utf8",
    );

    expect(environment).toContain("NEXT_PUBLIC_COSTON2_RPC_URL=");
    expect(environment).toContain("NEXT_PUBLIC_ATTESTATION_WORKER_URL=");
    expect(environment).not.toMatch(
      /FDC_VERIFIER_API_KEY|PRIVATE_KEY|XRPL_SEED/,
    );
  });
});
