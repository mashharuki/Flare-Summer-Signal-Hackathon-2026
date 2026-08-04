import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("hackathon README", () => {
  it("explains the product, Flare integrations, and reproducible demo", async () => {
    const readme = await readFile(
      new URL("../../../README.md", import.meta.url),
      "utf8",
    );

    for (const section of [
      "## 概要",
      "## 解決した課題",
      "## このプロダクトにおける具体的なアプローチ",
      "## ハッカソンで実装した機能一覧表",
      "## システム構成図",
      "## 技術スタック",
    ]) {
      expect(readme).toContain(section);
    }

    expect(readme).toContain("Interoperable Asset Products");
    expect(readme).toContain("FDC");
    expect(readme).toContain("FTSO");
    expect(readme).toContain("testXRP");
    expect(readme).toContain("```mermaid");
    expect(readme).toContain("本番融資");
  });
});
