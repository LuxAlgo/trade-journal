// T32 (docs/i18n.md §9/§14): the AI endpoints phrase their prompt language
// requirements from the validated NEXT_LOCALE cookie. The provider is mocked
// ("ai".generateText) so prompt composition, per-locale recap structure, the
// import language note and the coded error paths are all verified without a
// real model; the real output language stays a manual acceptance item.
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APICallError } from "ai";

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: vi.fn(),
}));
const cookieJar = vi.hoisted(() => ({ locale: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "NEXT_LOCALE" && cookieJar.locale ? { name, value: cookieJar.locale } : undefined,
  }),
}));

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-i18n-ai-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, accounts, executions, trades, settings } = await import("../src/db");
const { insertExecutions } = await import("../src/server/executions");
const { setSetting } = await import("../src/server/settings");
const { generateText } = await import("ai");
const { POST: ask } = await import("../src/app/api/ai/ask/route");
const { POST: recap } = await import("../src/app/api/ai/recap/route");
const { POST: critique } = await import("../src/app/api/ai/critique/route");
const { parseStatementWithAi } = await import("../src/server/ai-import");
const { queryTrades } = await import("../src/server/trades-query");

const request = (body: unknown) =>
  new Request("http://localhost/api/ai/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const fills = [
  {
    symbol: "ONLY_A",
    side: "buy" as const,
    quantity: 1,
    price: 100,
    fee: 0,
    executedAt: "2026-09-15T09:00:00Z",
  },
  {
    symbol: "ONLY_A",
    side: "sell" as const,
    quantity: 1,
    price: 110,
    fee: 0,
    executedAt: "2026-09-15T10:00:00Z",
  },
];
const askBody = { question: "How did I do?", filters: {}, timeZone: "UTC" };
const recapBody = { date: "2026-09-15", filters: {}, timeZone: "UTC" };
const prompt = () => (vi.mocked(generateText).mock.calls.at(-1)![0] as { prompt: string }).prompt;
const system = () => (vi.mocked(generateText).mock.calls.at(-1)![0] as { system: string }).system;

beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-only-key");
  vi.stubEnv("OPENAI_API_KEY", "");
  cookieJar.locale = undefined;
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.delete(settings).run();
  db.insert(accounts)
    .values({ id: "a", name: "Account A", kind: "manual", createdAt: "2026-01-01" })
    .run();
  insertExecutions("a", fills, "manual");
  setSetting("timeZone", "UTC");
  vi.mocked(generateText).mockReset();
  vi.mocked(generateText).mockResolvedValue({
    text: "Controlled AI response",
  } as Awaited<ReturnType<typeof generateText>>);
});
afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

it("pins the ask response language while aggregate labels stay English", async () => {
  const response = await ask(request(askBody));
  expect(response.status).toBe(200);
  expect(prompt()).toContain("Respond in English (BCP 47: en-US)");
  expect(prompt()).toContain("By symbol (top 12)");
  expect((await response.json()).answer).toBe("Controlled AI response");
});

it.each([
  ["zh-CN", "Respond in 简体中文 (BCP 47: zh-CN)"],
  ["ja", "Respond in 日本語 (BCP 47: ja)"],
  ["fr", "Respond in Français (BCP 47: fr-FR)"],
])("writes the language directive into the ask prompt for %s", async (locale, directive) => {
  cookieJar.locale = locale;
  expect((await ask(request(askBody))).status).toBe(200);
  expect(prompt()).toContain(directive);
});

it("falls back to the English baseline for an invalid locale cookie", async () => {
  cookieJar.locale = "not-a-locale";
  expect((await ask(request(askBody))).status).toBe(200);
  expect(prompt()).toContain("Respond in English (BCP 47: en-US)");
  expect(prompt()).not.toContain("简体中文");
});

it("keeps the recap contract (first person, two bold headings, length) per locale", async () => {
  expect((await recap(request(recapBody))).status).toBe(200);
  expect(prompt()).toContain('in first person ("I"), 120-200 words');
  expect(prompt()).toContain("**Keep**");
  expect(prompt()).toContain("**Fix**");

  cookieJar.locale = "zh-CN";
  vi.mocked(generateText).mockResolvedValueOnce({
    text: "**保持**\n- 保持纪律\n\n**改进**\n- 降低仓位",
  } as Awaited<ReturnType<typeof generateText>>);
  const response = await recap(request(recapBody));
  expect(response.status).toBe(200);
  expect(prompt()).toContain("Respond in 简体中文 (BCP 47: zh-CN)");
  expect(prompt()).toContain("第一人称");
  expect(prompt()).toContain("**保持**");
  expect(prompt()).toContain("**改进**");
  // The machine data context keeps its English labels and the day's numbers.
  expect(prompt()).toContain("Journal scope: 2026-09-15 · All accounts · All trades · UTC");
  expect(prompt()).toContain("ONLY_A");
  // The mocked markdown passes through structurally intact: two bold group
  // headings, each followed by a list item.
  const body = await response.json();
  expect(body.scope.label).toContain("全部账户");
  const headings = (body.recap as string).match(/^\*\*.+\*\*$/gm) ?? [];
  expect(headings).toEqual(["**保持**", "**改进**"]);
});

it("localizes the single-trade critique language too", async () => {
  cookieJar.locale = "zh-CN";
  const key = queryTrades({ accounts: "a" }).trades[0]!.key;
  expect((await critique(request({ key }))).status).toBe(200);
  expect(prompt()).toContain("Respond in 简体中文 (BCP 47: zh-CN)");
  expect(prompt()).toContain("ONLY_A");
});

it("localizes only the free-text instruction of structured AI import", async () => {
  const extraction = {
    complete: true,
    sourceAccounts: ["A"],
    warnings: [],
    errors: [],
    executions: [
      {
        symbol: "AAPL",
        side: "buy",
        quantity: 2,
        price: 100,
        fee: 0,
        executedAt: "2026-09-01T09:30:00",
        assetClass: "equity",
        source: "Row 1",
      },
    ],
  };
  vi.mocked(generateText).mockResolvedValue({
    output: extraction,
    finishReason: "stop",
  } as Awaited<ReturnType<typeof generateText>>);
  const options = { provider: "openai" as const, model: "gpt-4.1-mini", apiKey: "k" };
  expect(
    (await parseStatementWithAi({ content: "statement", timeZone: "UTC" }, options)).executions,
  ).toHaveLength(1);
  expect(system()).toContain("Extract executions from the attached broker statement");
  expect(system()).toContain('warnings" and "errors" strings are read by the trader');
  expect(system()).toContain("BCP 47: en-US");

  cookieJar.locale = "zh-CN";
  await parseStatementWithAi({ content: "statement", timeZone: "UTC" }, options);
  expect(system()).toContain("简体中文 (BCP 47: zh-CN)");
  // The extraction rules themselves stay the machine-semantic English SYSTEM.
  expect(system()).toContain("Normalize dates to YYYY-MM-DDTHH:mm:ss");
});

it("keeps provider failures readable, coded and free of credential fragments", async () => {
  vi.mocked(generateText).mockRejectedValueOnce(
    new APICallError({
      message: "invalid x-api-key: sk-ant-LEAK",
      url: "https://api.anthropic.com/v1/messages",
      requestBodyValues: { api_key: "sk-ant-LEAK" },
      statusCode: 401,
      isRetryable: false,
    }),
  );
  const failed = await ask(request(askBody));
  const body = await failed.json();
  expect(failed.status).toBe(500);
  expect(body.code).toBe("ai_auth_error");
  expect(typeof body.error).toBe("string");
  expect(JSON.stringify(body)).not.toContain("sk-ant-LEAK");

  vi.stubEnv("ANTHROPIC_API_KEY", "");
  const unconfigured = await ask(request(askBody));
  const unconfiguredBody = await unconfigured.json();
  expect(unconfigured.status).toBe(500);
  expect(unconfiguredBody.code).toBe("ai_not_configured");
  expect(unconfiguredBody.error).toContain("AI is not configured");
});
