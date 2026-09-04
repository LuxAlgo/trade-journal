import { describe, expect, it } from "vitest";
import { aiFeedback } from "../src/lib/ai-feedback";

describe("AI feedback", () => {
  it("treats missing setup as guidance with a direct settings destination", () => {
    expect(
      aiFeedback(
        "AI is not configured — add your Anthropic API key in Settings (it stays on your machine).",
      ),
    ).toMatchObject({
      tone: "info",
      title: "Set up AI to continue",
      action: { href: "/settings#ai-settings" },
    });
  });
  it("distinguishes credentials, billing and temporary provider failures", () => {
    expect(aiFeedback("authentication_error: invalid x-api-key").action?.label).toBe(
      "Review AI settings",
    );
    expect(aiFeedback("Your credit balance is too low").title).toBe(
      "Your AI account needs attention",
    );
    expect(aiFeedback("rate_limit_error")).toMatchObject({ tone: "info", retry: true });
    expect(aiFeedback("overloaded_error").retry).toBe(true);
  });
  it("offers data-specific empty-state guidance without an unhelpful retry", () => {
    expect(aiFeedback("The journal is empty — import trades first").action?.href).toBe("/import");
    const recap = aiFeedback("No closed trades on this day to recap");
    expect(recap.title).toBe("No trades to recap yet");
    expect(recap.retry).toBeUndefined();
  });
  it("offers recovery for network and session failures", () => {
    expect(aiFeedback("Failed to fetch")).toMatchObject({
      title: "Couldn’t connect to AI",
      retry: true,
    });
    expect(aiFeedback("Unauthorized").action?.href).toBe("/login");
  });
  it("never echoes raw provider payloads or credentials into the notice", () => {
    const raw = 'Provider error: {secret: "sk-ant-PRIVATE", prompt: "PRIVATE JOURNAL"}';
    const notice = aiFeedback(raw);
    expect(notice.title).toBe("Couldn’t complete the AI request");
    expect(JSON.stringify(notice)).not.toContain("PRIVATE");
    expect(notice.retry).toBe(true);
  });
});
