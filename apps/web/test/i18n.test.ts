import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  getCopy,
  isLocale,
  type Locale,
} from "./../src/i18n.js";

describe("web i18n", () => {
  it("provides Japanese and English copy for the same product actions", () => {
    const japanese = getCopy("ja");
    const english = getCopy("en");

    expect(japanese.connectWallet).toBe("Coston2 を接続");
    expect(english.connectWallet).toBe("Connect Coston2");
    expect(english.borrowPreview).toBe("Borrow preview");
    expect(english.repayPreview).toBe("Repayment");
    expect(english.activity.kind.BORROWED).toBe("rfUSD borrowed");
    expect(japanese.activity.outcome.PENDING).toBe("検証待ち");
  });

  it("uses Japanese as the safe fallback and accepts only supported locales", () => {
    expect(DEFAULT_LOCALE).toBe("ja");
    expect(isLocale("ja")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
  });

  it("keeps parameterized transaction feedback in the selected language", () => {
    const english = getCopy("en" as Locale);
    const japanese = getCopy("ja");

    expect(english.borrowReady("40 rfUSD", "30 rfUSD", "175.00%")).toBe(
      "After submission: debt 40 rfUSD / available 30 rfUSD / health 175.00%",
    );
    expect(japanese.approvalRequired("20 rfUSD")).toBe(
      "先にrfUSD利用承認が必要です。承認後の借入残高: 20 rfUSD",
    );
  });
});
