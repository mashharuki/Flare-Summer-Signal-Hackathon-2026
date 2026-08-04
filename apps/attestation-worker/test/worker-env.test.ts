import { describe, expect, it } from "vitest";

import { loadWorkerEnvironment, workerEnvFilePath } from "../src/worker-env.js";

describe("worker environment loading", () => {
  it("resolves the worker-local .env beside the package, not the repository root", () => {
    const path = workerEnvFilePath(
      "file:///workspace/apps/attestation-worker/src/worker-env.ts",
    );
    expect(path.replaceAll("\\", "/")).toBe(
      "/workspace/apps/attestation-worker/.env",
    );
  });

  it("loads only an existing worker-local env file", () => {
    const loaded: string[] = [];
    const path = loadWorkerEnvironment({
      envFilePath: "/workspace/apps/attestation-worker/.env",
      exists: () => true,
      load: (value) => loaded.push(value),
    });

    expect(path).toBe("/workspace/apps/attestation-worker/.env");
    expect(loaded).toEqual(["/workspace/apps/attestation-worker/.env"]);
  });
});
