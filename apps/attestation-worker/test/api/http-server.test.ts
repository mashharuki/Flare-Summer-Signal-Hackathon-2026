import { describe, expect, it } from "vitest";

import { applyCors, toFetchRequest } from "../../src/api/http-server.js";

describe("worker HTTP transport", () => {
  it("preserves the request body and only permits the configured Web origin", async () => {
    const request = await toFetchRequest({
      body: JSON.stringify({ accountId: "account" }),
      headers: { host: "worker.example", origin: "https://app.example" },
      method: "POST",
      url: "/attestations/prepare",
    });
    const response = applyCors(
      Response.json({ ok: true }),
      request,
      "https://app.example",
    );

    expect(await request.json()).toEqual({ accountId: "account" });
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.example",
    );
  });

  it("does not grant cross-origin access to an unconfigured origin", async () => {
    const request = await toFetchRequest({
      headers: { host: "worker.example", origin: "https://attacker.example" },
      method: "GET",
      url: "/health",
    });

    expect(
      applyCors(
        Response.json({ ok: true }),
        request,
        "https://app.example",
      ).headers.get("access-control-allow-origin"),
    ).toBeNull();
  });
});
