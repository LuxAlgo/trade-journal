/** Keep whitespace outside emphasis delimiters so toolbar output is valid Markdown. */
export function formatInlineSelection(
  value: string,
  start: number,
  end: number,
  marker: "*" | "**",
) {
  const selected = value.slice(start, end);
  const leading = selected.match(/^\s*/)?.[0] ?? "";
  const content = selected.trim() || (marker === "**" ? "bold text" : "italic text");
  const trailing = selected.trim() ? (selected.match(/\s*$/)?.[0] ?? "") : "";
  const replacement = leading + marker + content + marker + trailing;
  const selectionStart = start + leading.length + marker.length;
  return {
    value: value.slice(0, start) + replacement + value.slice(end),
    selectionStart,
    selectionEnd: selectionStart + content.length,
  };
}

interface NoteNode {
  type: string;
  value?: string;
  children?: NoteNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

/** Repair the old toolbar's spaced delimiters at render time; never rewrite saved notes.
 * Only plain text is eligible. Code, escaped stars and already parsed formatting stay intact.
 */
export function remarkRepairSpacedEmphasis() {
  return (tree: NoteNode, file: { value: unknown }) => {
    const source = String(file.value);
    const visit = (parent: NoteNode) => {
      if (!parent.children) return;
      parent.children = parent.children.flatMap((node): NoteNode[] => {
        if (node.type !== "text" || !node.value) {
          visit(node);
          return [node];
        }
        const raw = source.slice(node.position?.start.offset, node.position?.end.offset);
        if (raw !== node.value) return [node];
        const parts: NoteNode[] = [];
        let cursor = 0;
        for (const match of node.value.matchAll(/(?<!\*)(\*{1,2})([^*\n]+)\1(?!\*)/g)) {
          const content = match[2]!;
          if (!content.trim() || content === content.trim()) continue;
          const leading = content.match(/^[ \t]*/)?.[0] ?? "";
          const trailing = content.match(/[ \t]*$/)?.[0] ?? "";
          parts.push({ type: "text", value: node.value.slice(cursor, match.index) + leading });
          parts.push({
            type: match[1] === "**" ? "strong" : "emphasis",
            children: [{ type: "text", value: content.trim() }],
          });
          parts.push({ type: "text", value: trailing });
          cursor = match.index! + match[0].length;
        }
        if (!parts.length) return [node];
        parts.push({ type: "text", value: node.value.slice(cursor) });
        return parts;
      });
    };
    visit(tree);
  };
}
