// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipProvider } from "../src/components/ui/tooltip";
const state = vi.hoisted(() => ({ post: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/components/filter-bar", () => ({ FilterBar: () => null }));
vi.mock("@/components/manual-trade-entry", () => ({ ManualTradeEntry: () => null }));
vi.mock("@/components/import-reconciliation", () => ({ ImportReconciliation: () => null }));
vi.mock("@/components/timezone-picker", () => ({ TimeZonePicker: () => null }));
vi.mock("@/components/account-picker", () => ({
  AccountPicker: ({ onChange }: { onChange: (id: string) => void }) =>
    createElement("button", { onClick: () => onChange("test-account") }, "Choose test account"),
}));
vi.mock("@/lib/use-api", () => ({
  postJson: (...args: unknown[]) => state.post(...args),
  useApi: (url: string) => ({
    data:
      url === "/api/settings"
        ? {
            timeZone: "UTC",
            importTimeZone: "UTC",
            aiProvider: "openai",
            aiModel: "gpt-4.1-mini",
            aiConfigured: true,
            aiConnections: {
              openai: { configured: true, model: "gpt-4.1-mini", source: "saved" },
              anthropic: { configured: false, model: "claude-opus-5", source: null },
            },
          }
        : { formats: [] },
  }),
}));
const { default: ImportPage } = await import("../src/app/import/page");
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.post.mockReset();
  vi.spyOn(window, "alert").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
const render = () =>
  act(async () => root.render(createElement(TooltipProvider, null, createElement(ImportPage))));
const button = (name: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent === name,
  )!;
const workbookBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x7f]);
const upload = (size = workbookBytes.length) =>
  act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [{ name: "account.xlsx", size, arrayBuffer: async () => workbookBytes.buffer }],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

it("sends an XTB workbook to the server as base64 for both preview and commit", async () => {
  await render();
  state.post.mockResolvedValueOnce({
    detected: "xtb",
    timeZone: "UTC",
    needsMapping: false,
    executions: [],
    warnings: [],
    totals: { executions: 2, symbols: 1, skippedRows: 0, from: null, to: null },
  });
  await upload();
  const content = Buffer.from(workbookBytes).toString("base64");
  expect(state.post.mock.calls[0]![1]).toMatchObject({
    mode: "preview",
    encoding: "xlsx",
    content,
    fileName: "account.xlsx",
  });
  await act(async () => button("Choose test account").click());
  state.post.mockResolvedValueOnce({ inserted: 2, duplicates: 0 });
  await act(async () => button("Import").click());
  expect(state.post.mock.calls[1]![1]).toMatchObject({
    mode: "commit",
    encoding: "xlsx",
    content,
    accountId: "test-account",
  });
});

it("keeps workbooks away from AI parsing and oversized uploads off the network", async () => {
  await render();
  await act(async () =>
    (container.querySelector("#ai-import-enabled") as HTMLButtonElement).click(),
  );
  await upload();
  expect(container.textContent).toContain("Turn off AI parsing for an XTB Excel report");
  await act(async () =>
    (container.querySelector("#ai-import-enabled") as HTMLButtonElement).click(),
  );
  await upload(5 * 1024 * 1024 + 1);
  expect(container.textContent).toContain("Excel uploads must be a .xlsx file of 5 MB or less.");
  expect(state.post).not.toHaveBeenCalled();
});
