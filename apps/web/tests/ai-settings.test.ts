import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-ai-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, settings } = await import("../src/db");
const { getAiBaseUrl, getAiKey, getAiModel, getAiProvider, aiBaseUrlEnvironment, setAiBaseUrl, setSetting, getSetting } =
  await import("../src/server/settings");
const { DEFAULT_ANTHROPIC_API_BASE_URL, DEFAULT_OPENAI_BASE_URL, AI_DEFAULT_MODELS } =
  await import("../src/lib/ai-settings");
const { GET, PATCH } = await import("../src/app/api/settings/route");
const { GET: exportData } = await import("../src/app/api/export/route");
const { aiConfigured, runAi } = await import("../src/server/ai");
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const request = (body: unknown) =>
  new Request("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const save = (body: unknown) => PATCH(request(body));
const state = async () => (await GET()).json();

beforeEach(() => {
  db.delete(settings).run();
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("ANTHROPIC_API_BASE_URL", "");
  vi.stubEnv("OPENAI_API_BASE_URL", "");
  vi.stubEnv("JOURNAL_PASSWORD", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected provider request");
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
afterAll(() => {
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("AI provider settings", () => {
  it("starts unconfigured and refuses requests before contacting a provider", async () => {
    expect(await state()).toMatchObject({
      aiProvider: "anthropic",
      aiConfigured: false,
      aiModel: "claude-opus-5",
    });
    await expect(runAi("Fixture prompt")).rejects.toThrow("AI is not configured");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves the legacy Anthropic key and model while keeping OpenAI separate", async () => {
    expect(
      (await save({ anthropicKey: "fixture-anthropic", aiModel: "claude-custom" })).status,
    ).toBe(200);
    expect(getAiProvider()).toBe("anthropic");
    expect(
      (await save({ aiProvider: "openai", openaiKey: "  fixture-openai  ", aiModel: "gpt-4.1" }))
        .status,
    ).toBe(200);
    expect(await state()).toMatchObject({
      aiProvider: "openai",
      aiConfigured: true,
      aiModel: "gpt-4.1",
    });
    expect(getAiKey("anthropic")).toBe("fixture-anthropic");
    expect(getAiKey("openai")).toBe("fixture-openai");
    await save({ aiProvider: "anthropic" });
    expect(getAiModel("anthropic")).toBe("claude-custom");
    await save({ aiProvider: "openai" });
    expect(getAiModel("openai")).toBe("gpt-4.1");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("encrypts keys and omits keys and ciphertext from API responses and journal exports", async () => {
    const response = await save({
      aiProvider: "openai",
      openaiKey: "fixture-private-openai",
      anthropicKey: "fixture-private-anthropic",
    });
    const rows = JSON.stringify(db.select().from(settings).all());
    expect(rows).not.toContain("fixture-private");
    const exported = await exportData(new Request("http://localhost/api/export"));
    for (const body of [await response.text(), await (await GET()).text(), await exported.text()]) {
      expect(body).not.toContain("fixture-private");
      expect(body).not.toContain(getSetting("openaiKeyEnc")!);
      expect(body).not.toContain(getSetting("anthropicKeyEnc")!);
    }
  });

  it("removes only the selected key and never falls back from an explicit provider choice", async () => {
    await save({
      aiProvider: "openai",
      openaiKey: "fixture-openai",
      anthropicKey: "fixture-anthropic",
    });
    await save({ openaiKey: null });
    expect(getAiKey("anthropic")).toBe("fixture-anthropic");
    expect(getAiKey("openai")).toBeNull();
    expect(aiConfigured()).toBe(false);
    await expect(runAi("Fixture")).rejects.toThrow("OpenAI API key");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("selects an OpenAI-only environment and preserves Anthropic when both keys exist", async () => {
    vi.stubEnv("OPENAI_API_KEY", "fixture-env-openai");
    expect(await state()).toMatchObject({
      aiProvider: "openai",
      aiModel: "gpt-4.1-mini",
      aiConnections: { openai: { configured: true, source: "environment" } },
    });
    vi.stubEnv("ANTHROPIC_API_KEY", "fixture-env-anthropic");
    expect(getAiProvider()).toBe("anthropic");
    await save({ aiProvider: "openai", aiModel: "gpt-4.1" });
    expect(getAiProvider()).toBe("openai");
  });

  it.each(["openai", "anthropic"] as const)(
    "honors %s environment precedence and blocks misleading key edits",
    async (provider) => {
      await save({ [`${provider}Key`]: "fixture-saved" });
      vi.stubEnv(provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY", "fixture-env");
      expect(getAiKey(provider)).toBe("fixture-env");
      for (const key of [null, "fixture-replacement"])
        expect((await save({ [`${provider}Key`]: key })).status).toBe(400);
      expect((await save({ aiProvider: provider, aiModel: "custom-text-model" })).status).toBe(200);
    },
  );

  it("validates the entire request before writing any settings", async () => {
    for (const invalid of [
      { aiProvider: "unknown" },
      { aiProvider: null },
      { aiModel: 42 },
      { aiModel: "" },
      { aiModel: "a\nb" },
      ...["", " ", 42, {}, "key\nvalue", "a".repeat(4097)].flatMap((key) => [
        { openaiKey: key },
        { anthropicKey: key },
      ]),
    ]) {
      expect((await save({ timeZone: "America/Jamaica", ...invalid })).status).toBe(400);
      expect(db.select().from(settings).all()).toHaveLength(0);
    }
    for (const body of [null, [], 42]) expect((await save(body)).status).toBe(400);
  });

  it("treats unreadable saved credentials as unconfigured", async () => {
    setSetting("openaiKeyEnc", "broken-envelope");
    setSetting("aiProvider", "openai");
    expect(await state()).toMatchObject({
      aiConfigured: false,
      aiConnections: { openai: { source: null } },
    });
  });

  it("requires the journal session for reads and writes when a password is configured", async () => {
    vi.stubEnv("JOURNAL_PASSWORD", "fixture-password");
    expect((await GET()).status).toBe(401);
    expect((await save({ openaiKey: "fixture-key" })).status).toBe(401);
    expect(getAiKey("openai")).toBeNull();
  });
});

describe("AI provider base URLs", () => {
  it("defaults each provider to its own API base URL", async () => {
    expect(aiBaseUrlEnvironment("anthropic")).toBeNull();
    expect(aiBaseUrlEnvironment("openai")).toBeNull();
    expect(getAiBaseUrl("anthropic")).toBe(DEFAULT_ANTHROPIC_API_BASE_URL);
    expect(getAiBaseUrl("openai")).toBe(DEFAULT_OPENAI_BASE_URL);
    expect(await state()).toMatchObject({
      aiProvider: "anthropic",
      aiBaseUrl: DEFAULT_ANTHROPIC_API_BASE_URL,
      aiConnections: {
        anthropic: { baseUrl: DEFAULT_ANTHROPIC_API_BASE_URL },
        openai: { baseUrl: DEFAULT_OPENAI_BASE_URL },
      },
    });
  });

  it("prefers the provider environment base URL over any saved value", async () => {
    setAiBaseUrl("openai", "https://saved.example/v1");
    vi.stubEnv("OPENAI_API_BASE_URL", "  https://env.example/v1  ");
    expect(aiBaseUrlEnvironment("openai")).toBe("https://env.example/v1");
    expect(getAiBaseUrl("openai")).toBe("https://env.example/v1");
    expect(getAiBaseUrl("anthropic")).toBe(DEFAULT_ANTHROPIC_API_BASE_URL);
  });

  it("stores, isolates, and clears a custom base URL per provider", async () => {
    await save({
      aiProvider: "openai",
      openaiKey: "fixture-openai",
      aiBaseUrl: "https://proxy.example/v1",
    });
    expect(getAiBaseUrl("openai")).toBe("https://proxy.example/v1");
    expect(getAiBaseUrl("anthropic")).toBe(DEFAULT_ANTHROPIC_API_BASE_URL);
    expect(await state()).toMatchObject({
      aiProvider: "openai",
      aiBaseUrl: "https://proxy.example/v1",
      aiConnections: {
        openai: { baseUrl: "https://proxy.example/v1" },
        anthropic: { baseUrl: DEFAULT_ANTHROPIC_API_BASE_URL },
      },
    });
    expect((await save({ aiBaseUrl: "   " })).status).toBe(200);
    expect(getAiBaseUrl("openai")).toBe(DEFAULT_OPENAI_BASE_URL);
  });

  it("rejects malformed base URLs before writing any settings", async () => {
    for (const aiBaseUrl of [
      "ftp://nope",
      "not a url",
      "https://",
      42,
      `https://${"a".repeat(2049)}`,
    ]) {
      expect((await save({ aiBaseUrl })).status).toBe(400);
      expect(db.select().from(settings).all()).toHaveLength(0);
    }
  });

  it("routes OpenAI requests through a custom compatible base URL", async () => {
    await save({
      aiProvider: "openai",
      openaiKey: "fixture-openai",
      aiBaseUrl: "https://proxy.example/v1",
    });
    const fetcher = vi.fn(async () =>
      Response.json({
        id: "resp_fixture",
        created_at: 1,
        model: "gpt-4.1-mini",
        status: "completed",
        output: [
          {
            type: "message",
            id: "msg_fixture",
            role: "assistant",
            content: [{ type: "output_text", text: "Fixture reflection", annotations: [] }],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await runAi("Fixture journal question", 700)).toBe("Fixture reflection");
    const [url] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0]!;
    expect(url).toBe("https://proxy.example/v1/responses");
  });

  it("routes Anthropic requests through a custom compatible base URL", async () => {
    await save({
      aiProvider: "anthropic",
      anthropicKey: "fixture-anthropic",
      aiBaseUrl: "https://proxy.example/v1",
    });
    const fetcher = vi.fn(async () =>
      Response.json({
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content: [{ type: "text", text: "Anthropic fixture" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await runAi("Fixture prompt", 800)).toBe("Anthropic fixture");
    const [url] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0]!;
    expect(url).toBe("https://proxy.example/v1/messages");
  });
});

describe("AI provider requests through the real SDK adapters", () => {
  it("sends OpenAI's key and model to Responses with storage disabled", async () => {
    await save({
      aiProvider: "openai",
      openaiKey: "fixture-openai",
      anthropicKey: "fixture-anthropic",
    });
    const fetcher = vi.fn(async () =>
      Response.json({
        id: "resp_fixture",
        created_at: 1,
        model: "gpt-4.1-mini",
        status: "completed",
        output: [
          {
            type: "message",
            id: "msg_fixture",
            role: "assistant",
            content: [{ type: "output_text", text: "Fixture reflection", annotations: [] }],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await runAi("Fixture journal question", 700)).toBe("Fixture reflection");
    const [url, init] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer fixture-openai");
    expect(JSON.stringify(init)).not.toContain("fixture-anthropic");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "gpt-4.1-mini", max_output_tokens: 700, store: false });
    expect(JSON.stringify(body.input)).toContain("Fixture journal question");
  });

  it("keeps Anthropic requests using their own key, model, and endpoint", async () => {
    await save({
      anthropicKey: "fixture-anthropic",
      openaiKey: "fixture-openai",
      aiProvider: "anthropic",
      aiModel: "claude-custom",
    });
    const fetcher = vi.fn(async () =>
      Response.json({
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        model: "claude-custom",
        content: [{ type: "text", text: "Anthropic fixture" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await runAi("Fixture prompt", 800)).toBe("Anthropic fixture");
    const [url, init] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(new Headers(init.headers).get("x-api-key")).toBe("fixture-anthropic");
    expect(JSON.stringify(init)).not.toContain("fixture-openai");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "claude-custom",
      max_tokens: 800,
    });
  });

  it.each([
    [401, "Incorrect API key provided: fixture-private", "authentication_error"],
    [400, "You exceeded your current quota: fixture-private", "AI billing"],
    [404, "Model does not exist: fixture-private", "AI model unavailable"],
  ])("sanitizes provider errors (%s)", async (status, message, expected) => {
    await save({ aiProvider: "openai", openaiKey: "fixture-openai" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { message, type: "invalid_request_error", code: "fixture" } },
          { status: Number(status) },
        ),
      ),
    );
    const error = await runAi("Fixture").catch((error) => error as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(expected);
    expect((error as Error).message).not.toContain("fixture-private");
  });

  it("preserves rate-limit guidance after the SDK exhausts its retries", async () => {
    await save({ aiProvider: "openai", openaiKey: "fixture-openai" });
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              message: "Rate limit exceeded",
              type: "rate_limit_error",
              code: "rate_limit_exceeded",
            },
          },
          { status: 429 },
        ),
      ),
    );
    const result = runAi("Fixture").catch((error) => error as Error);
    await vi.runAllTimersAsync();
    expect(((await result) as Error).message).toContain("AI rate limit");
  });
});
