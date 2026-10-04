import { describe, expect, it } from "vitest";
import { aiFeedback } from "../src/lib/ai-feedback";
import { loadMessages } from "./helpers/i18n";

// T32: aiFeedback now returns stable message KEYS in the `ai` namespace; the
// regexes still match the server's stable English error text (docs/i18n.md §6).
describe("AI feedback", () => {
  it("explains empty or invalid scopes without suggesting an AI connection problem", () => {
    for (const message of [
      "No trades match the selected accounts and filters",
      "No closed trades match this day and the selected filters",
    ])
      expect(aiFeedback(message)).toEqual({
        titleKey: "feedback.noMatchingTrades.title",
        descriptionKey: "feedback.noMatchingTrades.description",
        tone: "info",
      });
    expect(aiFeedback("A selected account no longer exists. Update your filters.").titleKey).toBe(
      "feedback.checkFilters.title",
    );
    expect(aiFeedback("Journal timezone changed. Refresh and try again.").titleKey).toBe(
      "feedback.refreshJournal.title",
    );
  });
  it("treats missing setup as guidance with a direct settings destination", () => {
    expect(
      aiFeedback(
        "AI is not configured — add your Anthropic API key in Settings (it stays on your machine).",
      ),
    ).toMatchObject({
      tone: "info",
      titleKey: "feedback.setUpAi.title",
      action: { labelKey: "action.setUp", href: "/settings#ai-settings" },
    });
  });
  it("distinguishes credentials, billing and temporary provider failures", () => {
    expect(aiFeedback("authentication_error: invalid x-api-key").action?.labelKey).toBe(
      "action.reviewSettings",
    );
    expect(aiFeedback("Your credit balance is too low").titleKey).toBe("feedback.billing.title");
    expect(aiFeedback("rate_limit_error")).toMatchObject({ tone: "info", retry: true });
    expect(aiFeedback("overloaded_error").retry).toBe(true);
  });
  it("offers data-specific empty-state guidance without an unhelpful retry", () => {
    expect(aiFeedback("The journal is empty — import trades first").action?.href).toBe("/import");
    const recap = aiFeedback("No closed trades on this day to recap");
    expect(recap.titleKey).toBe("feedback.noRecap.title");
    expect(recap.retry).toBeUndefined();
  });
  it("recognizes OpenAI credentials, quota and model errors without showing key fragments", () => {
    const notice = aiFeedback("Incorrect API key provided: sk-proj-PRIVATE");
    expect(notice.action?.labelKey).toBe("action.reviewSettings");
    expect(JSON.stringify(notice)).not.toContain("PRIVATE");
    expect(aiFeedback("insufficient_quota").titleKey).toBe("feedback.billing.title");
    expect(aiFeedback("You exceeded your current quota").retry).toBeUndefined();
    expect(aiFeedback("AI model unavailable").titleKey).toBe("feedback.checkModel.title");
  });
  it("offers recovery for network and session failures", () => {
    expect(aiFeedback("Failed to fetch")).toMatchObject({
      titleKey: "feedback.connection.title",
      retry: true,
    });
    expect(aiFeedback("Unauthorized").action?.href).toBe("/login");
  });
  it("never echoes raw provider payloads or credentials into the notice", () => {
    const raw = 'Provider error: {secret: "sk-ant-PRIVATE", prompt: "PRIVATE JOURNAL"}';
    const notice = aiFeedback(raw);
    expect(notice.titleKey).toBe("feedback.fallback.title");
    expect(JSON.stringify(notice)).not.toContain("PRIVATE");
    expect(notice.retry).toBe(true);
  });
  it("keys resolve to the English baseline copy for every notice it can return", () => {
    const messages = loadMessages("en") as Record<string, Record<string, unknown>>;
    const ai = messages.ai as Record<string, unknown>;
    const lookup = (key: string): unknown =>
      key
        .split(".")
        .reduce<unknown>(
          (node, part) =>
            node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
          ai,
        );
    for (const message of [
      "No trades match the selected accounts and filters",
      "A selected account no longer exists",
      "Journal timezone changed",
      "AI is not configured — add your Anthropic API key in Settings.",
      "authentication_error: invalid x-api-key",
      "Your credit balance is too low",
      "AI model unavailable",
      "rate_limit_error",
      "The journal is empty — import trades first",
      "No closed trades on this day to recap",
      "Unauthorized",
      "Failed to fetch",
      'Provider error: {"secret":"x"}',
    ]) {
      const feedback = aiFeedback(message);
      expect(lookup(feedback.titleKey), feedback.titleKey).toEqual(expect.any(String));
      expect(lookup(feedback.descriptionKey), feedback.descriptionKey).toEqual(expect.any(String));
      if (feedback.action) expect(lookup(feedback.action.labelKey)).toEqual(expect.any(String));
    }
    expect(lookup("tryAgain")).toBe("Try again");
    expect(lookup("dismiss")).toBe("Dismiss AI notice");
  });
});
