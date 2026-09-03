import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { formatInlineSelection, remarkRepairSpacedEmphasis } from "../src/lib/note-formatting";

const render = (text: string) =>
  renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: [remarkRepairSpacedEmphasis], children: text }),
  );

describe("note formatting", () => {
  it("renders the existing spaced-bold note from the reported screenshot", () => {
    expect(render("**This is a new **notes test")).toBe(
      "<p><strong>This is a new</strong> notes test</p>",
    );
  });
  it("keeps selection whitespace outside bold and italic markers", () => {
    for (const marker of ["*", "**"] as const) {
      const next = formatInlineSelection("A new notes test", 2, 6, marker);
      expect(next.value).toBe(`A ${marker}new${marker} notes test`);
      expect(next.value.slice(next.selectionStart, next.selectionEnd)).toBe("new");
      expect(render(next.value)).toContain(
        marker === "**" ? "<strong>new</strong>" : "<em>new</em>",
      );
    }
  });
  it("inserts selected placeholder text when formatting without a selection", () => {
    const next = formatInlineSelection("Test ", 5, 5, "**");
    expect(next.value.slice(next.selectionStart, next.selectionEnd)).toBe("bold text");
    expect(render(next.value)).toBe("<p>Test <strong>bold text</strong></p>");
  });
  it("preserves code, escaped literal stars, and valid formatting", () => {
    expect(render("`**code **` \\*\\*literal \\*\\* and **bold**")).toBe(
      "<p><code>**code **</code> **literal ** and <strong>bold</strong></p>",
    );
    expect(render("```\n**code **\n```")).toContain("<code>**code **\n</code>");
  });
  it("does not interpret raw HTML as markup", () => {
    expect(render("**Text **<img src=x onerror=alert(1)>")).not.toContain("<img");
  });
});
