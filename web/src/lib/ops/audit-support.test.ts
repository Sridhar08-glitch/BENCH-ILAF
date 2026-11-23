import { describe, expect, it } from "vitest";
import { createI18n } from "@/lib/i18n";
import { CATALOGUES } from "@/lib/i18n/messages";
import { APP_NAME } from "@/lib/config";
import { ACTION_GROUPS, describeEvent } from "./audit";

// What the customer reads in the company Activity log when the product team looks at or changes their account.
describe("support entries in the company Activity log", () => {
  for (const locale of ["en", "ar"] as const) {
    const i18n = createI18n(locale, "latn", CATALOGUES[locale]);
    const say = (action: string, details: Record<string, unknown> = {}, target = "Alice") => describeEvent({ action, target_label: target, details, label: "BACKEND-LABEL" }, i18n);

    it(`says that support looked at the account, with the reason, in ${locale}`, () => {
      const text = say("support.viewed", { reason: "Owner asked us to check a card", minutes: 30 });
      expect(text).toContain("Owner asked us to check a card");
      expect(text).toContain(APP_NAME);
      expect(text).not.toBe("BACKEND-LABEL");
      expect(text).not.toMatch(/\{|company\./);
      if (locale === "ar") expect(text).toMatch(/[؀-ۿ]/);
    });

    it(`says when the look ended in ${locale}`, () => {
      const text = say("support.ended", { minutes: 12, pages: 3 });
      expect(text).toContain("12");
      expect(text).not.toBe("BACKEND-LABEL");
      if (locale === "ar") expect(text).toMatch(/[؀-ۿ]/);
    });

    it(`words a suspension by support and a restore, for the company and for a card, in ${locale}`, () => {
      for (const action of ["company.suspended", "company.restored"]) expect(say(action)).not.toBe("BACKEND-LABEL");
      const card = say("card.suspended", { by: "support" });
      expect(card).toContain("Alice");
      expect(card).not.toBe(say("card.suspended", {}));
      expect(say("card.restored", { by: "support" })).not.toBe(say("card.restored", {}));
    });
  }

  it("has a filter group for the support team's entries", () => {
    expect(ACTION_GROUPS.some((g) => g.key === "support.")).toBe(true);
  });
});
