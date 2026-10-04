// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentType, type ReactNode } from "react";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { renderWithLocale } from "./helpers/i18n";

/**
 * Representative i18n tests for the journal + notebook pages (wave 3, T27/T28):
 * the journal list renders the "{n} trades" plural per language, and the
 * notebook delete button is operable through its localized accessible name,
 * asking for confirmation with the localized message before any request.
 */

const state = vi.hoisted(() => ({
  data: null as unknown,
  post: vi.fn(),
}));

vi.mock("@/app/loading", () => ({ default: () => createElement("div", null, "loading") }));
vi.mock("@/components/filter-bar", () => ({
  FilterBar: ({ title, actions }: { title: string; actions?: ReactNode }) =>
    createElement("div", { "data-testid": "filter-bar" }, title, actions ?? null),
  useFilters: () => ({ values: {}, query: "", timeZone: "UTC" }),
}));
vi.mock("@/lib/use-api", () => ({
  postJson: (...args: unknown[]) => state.post(...args),
  useApi: () => ({ data: state.data, error: null, refresh: vi.fn() }),
}));
vi.mock("@/lib/use-autosave", () => ({
  formatAutosaveStatus: (_c: unknown, _e: unknown, s: { state: string } | undefined, fb: string) =>
    !s || s.state === "idle"
      ? fb
      : s.state === "error"
        ? `Not saved: x`
        : s.state === "saving"
          ? "Saving…"
          : "Saved",
  useAutosave: () => ({
    save: vi.fn(),
    status: "Saved",
    saveState: { state: "saved", message: "", errorInfo: null },
    flush: vi.fn(),
  }),
}));
vi.mock("@/components/pnl", () => ({
  Pnl: ({ value }: { value: number }) => createElement("span", null, String(value)),
}));
vi.mock("@/components/privacy", () => ({
  MonetaryValue: ({ children }: { children: ReactNode }) => createElement("span", null, children),
}));
vi.mock("@/components/voice-note", () => ({ VoiceNote: () => null }));
vi.mock("@/components/ai-recap", () => ({ AiRecap: () => null }));
vi.mock("@/components/attachments", () => ({ Attachments: () => null }));
vi.mock("@/components/review-export", () => ({ ReviewExport: () => null }));
vi.mock("@/components/rich-editor", () => ({ RichEditor: () => null }));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => createElement("a", { href, className }, children),
}));

beforeEach(() => {
  state.data = null;
  state.post.mockReset();
});

afterEach(() => {
  document.body.innerHTML = "";
});

// Buttons render a Radix HoverHint, which requires the app's provider.
const page = (Page: ComponentType) => createElement(TooltipProvider, null, createElement(Page));

describe("journal page (i18n)", () => {
  it("renders the title and the {n} trades plural under en and zh-CN", async () => {
    const { default: JournalPage } = await import("../src/app/journal/page");
    state.data = {
      days: [
        {
          date: "2026-09-01",
          stats: { netPnl: 100, trades: 1, wins: 1, losses: 0 },
          hasNote: false,
          notePreview: "",
        },
        {
          date: "2026-09-02",
          stats: { netPnl: -50, trades: 3, wins: 1, losses: 2 },
          hasNote: true,
          notePreview: "x",
        },
      ],
    };
    for (const [locale, title, viewDay, one, many] of [
      ["en", "Daily journal", "View my day", "1 trade", "3 trades"],
      ["zh-CN", "每日日志", "查看今天", "1 笔交易", "3 笔交易"],
    ] as const) {
      const { container, unmount } = renderWithLocale(page(JournalPage), { locale });
      const text = container.textContent ?? "";
      expect(text, `title (${locale})`).toContain(title);
      expect(text, `today entry (${locale})`).toContain(viewDay);
      expect(text, `singular (${locale})`).toContain(one);
      expect(text, `plural (${locale})`).toContain(many);
      expect(text, `no singular slip (${locale})`).not.toContain("1 trades");
      unmount();
    }
  });
});

describe("notebook page (i18n)", () => {
  it("asks to delete via the localized accessible name and keeps the note on cancel", async () => {
    const { default: NotebookPage } = await import("../src/app/notebook/page");
    state.data = {
      notes: [
        {
          id: "n1",
          folderId: "f1",
          title: "My note",
          content: "hello",
          updatedAt: "2026-09-01T10:00:00Z",
        },
      ],
      folders: [{ id: "f1", name: "Work", kind: "user" }],
    };
    state.post.mockResolvedValue({});
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      for (const [locale, deleteName, confirmText] of [
        ["en", "Delete", "Delete this note?"],
        ["zh-CN", "删除", "确定要删除这条笔记吗？"],
      ] as const) {
        confirmSpy.mockClear();
        state.post.mockClear();
        const { container, unmount } = renderWithLocale(page(NotebookPage), { locale });
        // Select the note so the editor (and its Delete button) mounts.
        const noteButton = Array.from(container.querySelectorAll("button")).find((b) =>
          (b.textContent ?? "").includes("My note"),
        );
        expect(noteButton, `note list entry (${locale})`).toBeTruthy();
        await act(async () => {
          noteButton!.click();
        });
        const accessibleName = (el: HTMLElement) =>
          el.getAttribute("aria-label") ?? (el.textContent ?? "").trim();
        const del = Array.from(container.querySelectorAll("button")).find(
          (b) => accessibleName(b) === deleteName,
        );
        expect(del, `delete button by accessible name (${locale})`).toBeTruthy();
        await act(async () => {
          del!.click();
        });
        expect(confirmSpy).toHaveBeenCalledWith(confirmText);
        expect(state.post, `cancel keeps the note (${locale})`).not.toHaveBeenCalled();
        // Confirming the localized dialog issues the stored-id DELETE request.
        confirmSpy.mockReturnValue(true);
        await act(async () => {
          del!.click();
        });
        expect(state.post).toHaveBeenCalledWith("/api/notes/n1", undefined, "DELETE");
        confirmSpy.mockReturnValue(false);
        unmount();
      }
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
