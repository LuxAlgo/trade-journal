/**
 * Test helper for jsdom component tests that need a specific interface
 * language (docs/i18n.md §14, T08). Wraps the UI in NextIntlClientProvider
 * with an explicit locale + messages, so tests never depend on the
 * developer machine's navigator.language, timezone or network.
 *
 * Implemented with react-dom/client's createRoot + act because
 * @testing-library/react is not installed in this repo (matching how the
 * existing component tests render); the API mirrors testing-library's
 * render: pass `ui` and options, get `{ container, rerender, unmount }`.
 */
import { act } from "react";
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Same candidate layout as src/i18n/request.ts: repo root or apps/web cwd.
// (import.meta.url is not a file:// URL under vitest's jsdom environment.)
const messagesRootCandidates = () => [
  join(process.cwd(), "messages"),
  join(process.cwd(), "apps", "web", "messages"),
];

const resolveMessagesRoot = (): string => {
  const root = messagesRootCandidates().find((candidate) => existsSync(candidate));
  if (!root) {
    throw new Error(
      `Messages directory not found (searched: ${messagesRootCandidates().join(", ")})`,
    );
  }
  return root;
};

// React warns about act() outside of a test environment without this flag.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const messagesRoot = resolveMessagesRoot();

/**
 * Merge every `<ns>.json` file of `apps/web/messages/<locale>/` into one
 * messages object (same shape the server hands to NextIntlClientProvider).
 */
export const loadMessages = (locale: string): Record<string, unknown> => {
  const dir = join(messagesRoot, locale);
  const messages: Record<string, unknown> = {};
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith(".json")) continue;
    Object.assign(messages, JSON.parse(readFileSync(join(dir, entry), "utf8")));
  }
  return messages;
};

export type RenderWithLocaleOptions = {
  /** Interface language; defaults to "en" (the app's default locale). */
  locale?: string;
  /** Message object; defaults to the real apps/web/messages/<locale>/*.json. */
  messages?: Record<string, unknown>;
  /** Container element; defaults to a fresh div appended to document.body. */
  container?: HTMLElement;
};

export type RenderWithLocaleResult = {
  container: HTMLElement;
  /** Re-render the same provider with a different element tree. */
  rerender: (ui: ReactElement) => void;
  /** Unmount and remove the container (call in afterEach). */
  unmount: () => void;
};

export const renderWithLocale = (
  ui: ReactElement,
  options: RenderWithLocaleOptions = {},
): RenderWithLocaleResult => {
  const locale = options.locale ?? "en";
  const messages = options.messages ?? loadMessages(locale);
  const container = options.container ?? document.body.appendChild(document.createElement("div"));
  const root: Root = createRoot(container);
  const renderIntoRoot = (element: ReactElement) => {
    const tree = createElement(NextIntlClientProvider, {
      locale,
      messages,
      timeZone: "UTC",
      children: element,
    });
    act(() => {
      root.render(tree);
    });
  };

  renderIntoRoot(ui);

  return {
    container,
    rerender: (next: ReactElement) => {
      renderIntoRoot(next);
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};
