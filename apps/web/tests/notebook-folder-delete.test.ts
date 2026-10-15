// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import NotebookPage from "../src/app/notebook/page";
import { TooltipProvider } from "../src/components/ui/tooltip";

const state = vi.hoisted(() => ({
  url: "",
  post: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/use-api", () => ({
  useApi: (url: string) => {
    state.url = url;
    return {
      data: {
        notes: [],
        folders: [
          { id: "all", name: "All notes", kind: "system" },
          { id: "trade-notes", name: "Trade notes", kind: "system" },
          { id: "my-notes", name: "My notes", kind: "system" },
          { id: "custom", name: "Research", kind: "user" },
        ],
      },
      refresh: state.refresh,
    };
  },
  postJson: (...args: unknown[]) => state.post(...args),
}));
vi.mock("@/components/filter-bar", () => ({ FilterBar: () => null }));

let container: HTMLDivElement, root: Root;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.post.mockReset().mockResolvedValue({ deleted: true });
  state.refresh.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(createElement(TooltipProvider, null, createElement(NotebookPage))),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const removeButton = (name: string) =>
  container.querySelector<HTMLButtonElement>(
    `.notebook-folders button[aria-label="Delete folder: ${name}"]`,
  )!;
const dialog = () => document.querySelector('[role="dialog"]')!;
const confirmButton = () =>
  [...dialog().querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Delete folder",
  )!;

it("offers removal for custom and built-in folders, with a cancellable confirmation", async () => {
  expect(removeButton("Research")).not.toBeNull();
  expect(removeButton("Trade notes")).not.toBeNull();
  expect(removeButton("All notes")).toBeNull();
  expect(removeButton("My notes")).toBeNull();
  await act(async () => removeButton("Trade notes").click());
  expect(dialog().textContent).toContain("Its notes will be kept in My notes.");
  await act(async () =>
    [...dialog().querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Cancel")!
      .click(),
  );
  expect(state.post).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("removes the selected folder and opens My notes after success", async () => {
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>(".notebook-folders button")]
      .find((button) => button.textContent === "Research")!
      .click(),
  );
  await act(async () => removeButton("Research").click());
  await act(async () => confirmButton().click());
  expect(state.post).toHaveBeenCalledExactlyOnceWith("/api/folders/custom", undefined, "DELETE");
  expect(state.refresh).toHaveBeenCalledOnce();
  expect(state.url).toContain("folder=my-notes");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("shows deletion failures and leaves the folder available to retry", async () => {
  state.post.mockRejectedValueOnce(new Error("Could not remove folder"));
  await act(async () => removeButton("Research").click());
  await act(async () => confirmButton().click());
  expect(dialog().querySelector('[role="alert"]')?.textContent).toBe("Could not remove folder");
  expect(confirmButton().disabled).toBe(false);
  expect(state.refresh).not.toHaveBeenCalled();
  expect(removeButton("Research")).not.toBeNull();
});
