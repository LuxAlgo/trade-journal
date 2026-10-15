import { describe, expect, it } from "vitest";
import { en, zh } from "../src/lib/messages";
import { parseCustomBaseUrl } from "../src/lib/ai-settings";

const leaves = (value: unknown, path: string): string[] => {
  if (typeof value === "string") return value.trim() ? [] : [path];
  if (Array.isArray(value))
    return value.flatMap((item, index) =>
      typeof item === "string" && item.trim() ? [] : [`${path}.${index}`],
    );
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, child]) => leaves(child, `${path}.${key}`));
  return [path];
};

describe("interface language catalogs", () => {
  it("gives Chinese every English string", () => {
    expect(leaves(zh, "zh")).toEqual([]);
    expect(leaves(en, "en")).toEqual([]);
    expect(Object.keys(zh)).toEqual(Object.keys(en));
  });
});

describe("custom AI base URL", () => {
  it("keeps an OpenAI-compatible origin and /v1 path", () => {
    expect(parseCustomBaseUrl(" https://api.example.com/v1/ ")).toEqual({
      ok: true,
      url: "https://api.example.com/v1",
    });
    expect(parseCustomBaseUrl("http://127.0.0.1:11434/v1/chat/completions")).toEqual({
      ok: true,
      url: "http://127.0.0.1:11434/v1",
    });
  });

  it("rejects protocols, credentials, and query strings", () => {
    for (const value of [
      "",
      "javascript:alert(1)",
      "file:///tmp/model",
      "https://user:secret@api.example/v1",
      "https://api.example/v1?key=secret",
    ])
      expect(parseCustomBaseUrl(value).ok).toBe(false);
  });
});
