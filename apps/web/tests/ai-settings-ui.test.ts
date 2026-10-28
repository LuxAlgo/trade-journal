// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AiConnection, AiProvider, AiSettingsPayload } from "../src/lib/ai-settings";
const state = vi.hoisted(() => ({
  post: vi.fn(),
  refresh: vi.fn(),
  data: undefined as unknown,
}));
vi.mock("@/lib/use-api", () => ({
  postJson: (...args: unknown[]) => state.post(...args),
  useApi: () => ({ data: state.data, error: null, loading: false, refresh: state.refresh }),
}));
const { AiSettings } = await import("../src/components/ai-settings");
let container: HTMLDivElement;
let root: Root;
const connection = (model: string, extra: Partial<AiConnection> = {}): AiConnection => ({
  configured: false,
  source: null,
  model,
  baseUrl: null,
  ...extra,
});
const settings = (
  aiProvider: AiProvider,
  connections: Partial<Record<AiProvider, AiConnection>> = {},
): AiSettingsPayload => {
  const aiConnections = {
    anthropic: connection("claude-opus-5"),
    openai: connection("gpt-4.1-mini"),
    compatible: connection(""),
    ...connections,
  };
  return {
    aiProvider,
    aiConfigured: aiConnections[aiProvider].configured,
    aiModel: aiConnections[aiProvider].model,
    aiConnections,
  };
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.post.mockReset().mockResolvedValue({ saved: true });
  state.refresh.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const render = (data: AiSettingsPayload) => {
  state.data = data;
  return act(async () => root.render(createElement(AiSettings)));
};
const field = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`);
const type = (id: string, value: string) =>
  act(async () => {
    const input = field(id)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const saveButton = () =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent === "Save AI settings",
  )!;

it("saves an OpenAI-compatible server with a model and no key", async () => {
  await render(settings("compatible"));
  expect(container.textContent).toContain("API key (optional)");
  expect(saveButton().disabled).toBe(true);
  await type("ai-model", "llama3.1:8b");
  expect(saveButton().disabled).toBe(true);
  await type("ai-base-url", " http://localhost:11434/v1 ");
  expect(saveButton().disabled).toBe(false);
  await act(async () => saveButton().click());
  expect(state.post).toHaveBeenCalledWith(
    "/api/settings",
    {
      aiProvider: "compatible",
      aiModel: "llama3.1:8b",
      compatibleBaseUrl: "http://localhost:11434/v1",
    },
    "PATCH",
  );
  expect(state.refresh).toHaveBeenCalled();
});

it("shows the saved server and warns that a new URL drops its saved key", async () => {
  await render(
    settings("compatible", {
      compatible: connection("router-model", {
        configured: true,
        source: "saved",
        baseUrl: "https://router.example/api/v1",
      }),
    }),
  );
  expect(field("ai-base-url")!.value).toBe("https://router.example/api/v1");
  expect(container.textContent).toContain("Saving a different server URL removes it.");
  expect(container.textContent).toContain("Remove OpenAI-compatible key");
  expect(container.textContent).toContain("Server configured");
});

it("keeps hosted providers free of a server URL", async () => {
  await render(
    settings("openai", {
      openai: connection("gpt-4.1-mini", { configured: true, source: "saved" }),
      compatible: connection("llama3.1:8b", { baseUrl: "http://localhost:11434/v1" }),
    }),
  );
  expect(field("ai-base-url")).toBeNull();
  await act(async () => saveButton().click());
  expect(state.post.mock.calls[0]![1]).toEqual({ aiProvider: "openai", aiModel: "gpt-4.1-mini" });
});
