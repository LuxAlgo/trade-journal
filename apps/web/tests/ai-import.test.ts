import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText: vi.fn(),
}));
const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-ai-import-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, accounts, executions, trades, settings } = await import("../src/db");
const { setSetting } = await import("../src/server/settings");
const { generateText } = await import("ai");
const { validateAiExtraction, readAiImportPreview } = await import("../src/server/ai-import");
const { POST } = await import("../src/app/api/import/route");
const valid = () => ({
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
      source: "Row 2: Buy 2 AAPL at 100, fee 0",
    },
    {
      symbol: "AAPL",
      side: "sell",
      quantity: 2,
      price: 110,
      fee: 1,
      executedAt: "2026-09-01T10:30:00",
      assetClass: "equity",
      source: "Row 3: Sell 2 AAPL at 110, fee 1",
    },
  ],
});
const base = {
  content: "Unfamiliar statement: buy 2 AAPL at 100; sell 2 AAPL at 110",
  fileName: "statement.txt",
  timeZone: "America/Jamaica",
  ai: { provider: "openai", model: "gpt-4.1-mini", apiKey: "test-only-key" },
};
const request = (body: unknown) =>
  POST(
    new Request("http://localhost/api/import", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );
const modelResult = (output: unknown, finishReason = "stop") =>
  vi
    .mocked(generateText)
    .mockResolvedValue({ output, finishReason } as Awaited<ReturnType<typeof generateText>>);
beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.delete(settings).run();
  db.insert(accounts)
    .values({ id: "a", name: "Test", kind: "import", createdAt: "2026-01-01" })
    .run();
  vi.mocked(generateText).mockReset();
  modelResult(valid());
});
afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});
it("keeps native parsing local and unchanged when AI is off", async () => {
  const response = await request({
    mode: "preview",
    timeZone: "UTC",
    content:
      "Date,Time,Symbol,Quantity,Price,Side,Commission\n2026-09-01,09:30:00,AAPL,2,100,Buy,0",
  });
  const result = await response.json();
  expect(result.detected).toBe("tradervue");
  expect(result.totals.executions).toBe(1);
  expect(result.aiPreviewToken).toBeUndefined();
  expect(generateText).not.toHaveBeenCalled();
});
it.each(["openai", "anthropic"])(
  "uses %s for preview only, with no stored upload key",
  async (provider) => {
    const response = await request({ ...base, mode: "preview", ai: { ...base.ai, provider } });
    expect(response.status).toBe(200);
    const preview = await response.json();
    expect(preview.executions[0].executedAt).toBe("2026-09-01T14:30:00.000Z");
    expect(preview.sources).toHaveLength(2);
    expect(preview.aiPreviewToken).toBeTruthy();
    expect(db.select().from(executions).all()).toHaveLength(0);
    expect(db.select().from(settings).all()).toHaveLength(0);
    const options = vi.mocked(generateText).mock.calls[0]![0];
    expect(options.model).toHaveProperty(
      "provider",
      provider === "openai" ? "openai.responses" : "anthropic.messages",
    );
    if (provider === "openai")
      expect(options.providerOptions).toEqual({ openai: { store: false } });
    expect(JSON.stringify(preview)).not.toContain("test-only-key");
  },
);
it("commits exactly the reviewed result without calling AI again and preserves zero fees", async () => {
  setSetting(
    "journalDefaults",
    JSON.stringify({
      feeRules: [{ id: "default", accountId: "", symbol: "", amount: 5, mode: "execution" }],
    }),
  );
  const preview = await (await request({ ...base, mode: "preview" })).json();
  const commit = {
    ...base,
    ai: { ...base.ai, apiKey: undefined },
    mode: "commit",
    aiReviewed: true,
    aiPreviewToken: preview.aiPreviewToken,
    accountId: "a",
  };
  const response = await request(commit);
  expect(response.status).toBe(200);
  expect((await response.json()).inserted).toBe(2);
  expect(generateText).toHaveBeenCalledTimes(1);
  expect(
    db
      .select()
      .from(executions)
      .all()
      .map((e) => e.fee),
  ).toEqual([0, 1]);
  expect((await (await request(commit)).json()).duplicates).toBe(2);
  expect(generateText).toHaveBeenCalledTimes(1);
});
it("requires review and rejects tampered or stale previews", async () => {
  const preview = await (await request({ ...base, mode: "preview" })).json();
  const commit = {
    ...base,
    mode: "commit",
    accountId: "a",
    aiPreviewToken: preview.aiPreviewToken,
  };
  expect((await request(commit)).status).toBe(400);
  for (const patch of [
    { content: "changed" },
    { timeZone: "UTC" },
    { aiPreviewToken: "tampered" },
  ]) {
    expect((await request({ ...commit, aiReviewed: true, ...patch })).ok).toBe(false);
  }
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60_000);
  expect(() => readAiImportPreview(base, preview.aiPreviewToken)).toThrow(/expired/);
  now.mockRestore();
  expect(db.select().from(executions).all()).toHaveLength(0);
});
it.each([
  { complete: false },
  { errors: ["Missing entry price"] },
  { sourceAccounts: ["a", "b"] },
  { executions: [{ ...valid().executions[0], quantity: -1 }] },
  { executions: [{ ...valid().executions[0], executedAt: "2026-02-30T09:30:00" }] },
  { executions: [{ ...valid().executions[0], executedAt: "09/01/2026" }] },
  { executions: [{ ...valid().executions[0], fee: undefined }] },
  { executions: [{ ...valid().executions[0], source: "" }] },
  { executions: [valid().executions[0], valid().executions[0]] },
])("blocks incomplete or invalid extracted data: %j", (patch) => {
  expect(() => validateAiExtraction({ ...valid(), ...patch }, "UTC")).toThrow();
});
it("does not send an upload without a key, or when it exceeds the text limit", async () => {
  expect((await request({ ...base, mode: "preview", ai: { ...base.ai, apiKey: "" } })).status).toBe(
    400,
  );
  expect((await request({ ...base, mode: "preview", content: "a".repeat(150001) })).status).toBe(
    400,
  );
  expect(generateText).not.toHaveBeenCalled();
});
it.each(["openai", "anthropic"])("sends PDF bytes as a file input for %s", async (provider) => {
  const response = await request({
    ...base,
    mode: "preview",
    encoding: "pdf",
    content: Buffer.from("%PDF-1.4\nsynthetic test").toString("base64"),
    ai: { ...base.ai, provider },
  });
  expect(response.status).toBe(200);
  expect(JSON.stringify(vi.mocked(generateText).mock.calls[0]![0].messages)).toContain(
    '"mediaType":"application/pdf"',
  );
});
it("fails closed on truncated model output and sanitizes provider errors", async () => {
  modelResult(valid(), "length");
  expect((await request({ ...base, mode: "preview" })).ok).toBe(false);
  vi.mocked(generateText).mockRejectedValue(new Error("private-key provider request contents"));
  const response = await request({ ...base, mode: "preview" });
  expect(JSON.stringify(await response.json())).not.toContain("private-key");
  expect(db.select().from(executions).all()).toHaveLength(0);
});
