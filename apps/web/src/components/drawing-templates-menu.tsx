"use client";

import { useState } from "react";
import { LayoutTemplate, Save, Star, Trash2 } from "lucide-react";
import { drawingLabel } from "@/lib/chart-analysis";
import { templatesFor, type DrawingTemplate } from "@/lib/drawing-templates";
import { WAVE_DEGREES } from "@/lib/wave-degrees";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

/** What the menu works on, read when it opens: a tool, and how many of its drawings are selected. */
export interface TemplateTargetInfo {
  type: string;
  /** The selected drawings of that tool, kept while the menu is open (opening it clears the
   *  chart's own selection). */
  ids: string[];
}

/**
 * Templates for the selected drawing's tool (or the armed tool): apply one to the selected
 * drawings, save the selected drawing's look as one, delete yours, and star the one new
 * drawings of that tool start with.
 */
export function DrawingTemplatesMenu({
  resolveTarget,
  templates,
  defaults,
  onApply,
  onSave,
  onDelete,
  onDefault,
  onClose,
}: {
  resolveTarget: () => TemplateTargetInfo | null;
  templates: DrawingTemplate[];
  defaults: Record<string, string>;
  onApply: (template: DrawingTemplate, ids: string[]) => void;
  onSave: (type: string, name: string, ids: string[]) => void;
  onDelete: (id: string) => void;
  onDefault: (type: string, id: string | null) => void;
  /** The menu closed: select `ids` on the chart again. */
  onClose: (ids: string[]) => void;
}) {
  const [target, setTarget] = useState<TemplateTargetInfo | null>(null);
  const [name, setName] = useState("");
  const type = target?.type ?? null;
  const list = type ? templatesFor(templates, type) : [];
  const defaultId = type ? defaults[type] : undefined;
  const current = list.find((t) => t.id === defaultId);
  const ids = target?.ids ?? [];
  const selected = ids.length;
  const tool = type ? drawingLabel(type) : "";
  const save = () => {
    if (!type || !name.trim()) return;
    onSave(type, name, ids);
    setName("");
  };
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          setTarget(resolveTarget());
          setName("");
        } else if (ids.length) onClose(ids);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          title="Templates for the selected drawing, or the drawing tool you chose"
        >
          <LayoutTemplate /> Template
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[min(70vh,var(--radix-dropdown-menu-content-available-height))] w-80 overflow-y-auto"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {!type ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            Select a drawing on the chart, or choose a drawing tool, to see its templates.
          </p>
        ) : (
          <>
            <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {tool} templates
            </p>
            <p className="px-2 pb-1 text-[11px] text-muted-foreground">
              {selected
                ? `Click one to apply it to the ${selected === 1 ? "selected drawing" : `${selected} selected drawings`}. The star makes it the default for new ones.`
                : `Click one to start new ${tool.toLowerCase()} drawings with it.`}
            </p>
            {list.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                No templates yet. Style a drawing, select it and save its look below.
              </p>
            )}
            {list.map((template) => {
              const isDefault = template.id === defaultId;
              return (
                <DropdownMenuItem
                  key={template.id}
                  onSelect={() =>
                    selected
                      ? onApply(template, ids)
                      : onDefault(template.type, isDefault ? null : template.id)
                  }
                  className="gap-1"
                >
                  <span className="min-w-0 flex-1 truncate">{template.name}</span>
                  {template.builtIn && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">built-in</span>
                  )}
                  <button
                    type="button"
                    aria-label={
                      isDefault
                        ? `Stop starting new drawings with ${template.name}`
                        : `Start new drawings with ${template.name}`
                    }
                    aria-pressed={isDefault}
                    className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-accent"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onDefault(template.type, isDefault ? null : template.id);
                    }}
                  >
                    <Star
                      className={cn(
                        "size-3.5",
                        isDefault ? "fill-current text-amber-500" : "text-muted-foreground",
                      )}
                    />
                  </button>
                  {!template.builtIn && (
                    <button
                      type="button"
                      aria-label={`Delete the ${template.name} template`}
                      className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (confirm(`Delete the template "${template.name}"?`))
                          onDelete(template.id);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </DropdownMenuItem>
              );
            })}
            {selected > 0 && type.startsWith("elliott") && (
              <>
                <p className="border-t px-2 pb-0.5 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Wave degree
                </p>
                {WAVE_DEGREES.map((degree) => (
                  <DropdownMenuItem
                    key={degree.value || "none"}
                    onSelect={() =>
                      // Only the labels change; colours and lines stay as they are.
                      onApply(
                        {
                          id: `degree:${degree.value}`,
                          name: degree.label,
                          type,
                          props: { degree: degree.value },
                        },
                        ids,
                      )
                    }
                  >
                    {degree.label}
                  </DropdownMenuItem>
                ))}
              </>
            )}
            {selected > 0 && (
              <form
                className="flex gap-1 border-t px-2 pb-1 pt-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  save();
                }}
              >
                <input
                  value={name}
                  maxLength={60}
                  placeholder="Save its look as…"
                  aria-label="Template name"
                  // Typing stays in the field instead of jumping between menu items.
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) => setName(event.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                />
                <Button type="submit" size="sm" variant="outline" disabled={!name.trim()}>
                  <Save /> Save
                </Button>
              </form>
            )}
            <p className="px-2 pb-1.5 pt-1 text-[11px] text-muted-foreground">
              New {tool.toLowerCase()} drawings start with{" "}
              <strong>{current ? current.name : "the style you used last"}</strong>.
              {selected > 0 ? " Saving under an existing name updates it." : ""}
            </p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
