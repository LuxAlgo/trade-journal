"use client";

import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Eye,
  EyeOff,
  Folder,
  FolderPlus,
  Layers,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  addFolder,
  addLayer,
  assignDrawing,
  drawingsIn,
  effectiveLayer,
  moveLayer,
  removeFolder,
  removeLayer,
  renameFolder,
  renameLayer,
  setActiveLayer,
  updateFolder,
  updateLayer,
  type DrawingLayer,
  type LayerFolder,
  type LayersDocument,
} from "@/lib/chart-layers";
import { drawingLabel } from "@/lib/chart-analysis";
import { cn } from "@/lib/utils";
import type { ChartDrawing } from "./analysis-chart";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { HoverHint } from "./ui/tooltip";

/**
 * Folders → layers → drawings. The active layer (the filled dot) receives new drawings.
 * Eye and lock apply to everything inside; a folder's switch overrides its layers.
 */
export function LayersPanel({
  layers,
  drawings,
  selectedId,
  onChange,
  onRevealDrawings,
  onSelectDrawing,
  onDeleteDrawings,
}: {
  layers: LayersDocument;
  drawings: ChartDrawing[];
  selectedId: string | null;
  onChange: (next: LayersDocument) => void;
  onRevealDrawings: (ids: string[]) => void;
  onSelectDrawing: (id: string) => void;
  onDeleteDrawings: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set([layers.activeLayerId]));
  const [editing, setEditing] = useState<string | null>(null);
  const ids = drawings.map((d) => d.id);
  const byId = new Map(drawings.map((d) => [d.id, d]));
  const toggleOpen = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const deleteLayer = (layer: DrawingLayer) => {
    const inside = drawingsIn(layers, layer.id, ids);
    const others = layers.layers.filter((l) => l.id !== layer.id);
    let moveTo: string | null = null;
    if (inside.length) {
      const keep = confirm(
        `"${layer.name}" has ${inside.length} drawing${inside.length === 1 ? "" : "s"}. OK moves them to "${others[0]!.name}"; Cancel deletes them with the layer.`,
      );
      if (keep) moveTo = others[0]!.id;
      else if (!confirm(`Delete "${layer.name}" and its drawings?`)) return;
    }
    const result = removeLayer(layers, layer.id, moveTo);
    onChange(result.doc);
    if (result.deleteDrawings.length) onDeleteDrawings(result.deleteDrawings);
  };

  const renderLayer = (layer: DrawingLayer, folder?: LayerFolder) => {
    const inside = drawingsIn(layers, layer.id, ids);
    const effective = effectiveLayer(layers, layer);
    const active = layers.activeLayerId === layer.id;
    const expanded = open.has(layer.id);
    return (
      <li key={layer.id} className={cn(folder && "ml-4")}>
        <div
          className={cn(
            "group flex items-center gap-1 rounded-md px-1 py-0.5 text-sm",
            active ? "bg-accent/70" : "hover:bg-accent/40",
            !effective.visible && "opacity-60",
          )}
        >
          <button
            type="button"
            aria-label={expanded ? `Collapse ${layer.name}` : `Expand ${layer.name}`}
            onClick={() => toggleOpen(layer.id)}
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
          <HoverHint content={active ? "Active layer: new drawings go here" : "Draw on this layer"}>
            <button
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`Draw on ${layer.name}`}
              onClick={() => onChange(setActiveLayer(layers, layer.id))}
              className="flex size-6 shrink-0 items-center justify-center"
            >
              <span
                className={cn(
                  "block size-3 rounded-full border-2",
                  active ? "border-primary bg-primary" : "border-muted-foreground",
                )}
              />
            </button>
          </HoverHint>
          {editing === layer.id ? (
            <NameInput
              value={layer.name}
              label="Layer name"
              onDone={(name) => {
                setEditing(null);
                if (name !== null) onChange(renameLayer(layers, layer.id, name));
              }}
            />
          ) : (
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              onClick={() => onChange(setActiveLayer(layers, layer.id))}
              onDoubleClick={() => setEditing(layer.id)}
            >
              {layer.name}
            </button>
          )}
          <span className="tnum shrink-0 text-xs text-muted-foreground">{inside.length}</span>
          <IconToggle
            label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
            on={layer.visible}
            onIcon={Eye}
            offIcon={EyeOff}
            onClick={() => onChange(updateLayer(layers, layer.id, { visible: !layer.visible }))}
          />
          <IconToggle
            label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
            on={!layer.locked}
            onIcon={LockOpen}
            offIcon={Lock}
            onClick={() => onChange(updateLayer(layers, layer.id, { locked: !layer.locked }))}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label={`${layer.name} options`}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56"
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <DropdownMenuItem onSelect={() => setEditing(layer.id)}>
                <Pencil className="size-3.5" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!inside.length} onSelect={() => onRevealDrawings(inside)}>
                <Crosshair className="size-3.5" /> Show its drawings on the chart
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onChange(moveLayer(layers, layer.id, -1))}>
                <ArrowUp className="size-3.5" /> Move up
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onChange(moveLayer(layers, layer.id, 1))}>
                <ArrowDown className="size-3.5" /> Move down
              </DropdownMenuItem>
              {layer.folderId && (
                <DropdownMenuItem
                  onSelect={() => onChange(updateLayer(layers, layer.id, { folderId: null }))}
                >
                  <Layers className="size-3.5" /> Move out of folder
                </DropdownMenuItem>
              )}
              {layers.folders
                .filter((f) => f.id !== layer.folderId)
                .map((f) => (
                  <DropdownMenuItem
                    key={f.id}
                    onSelect={() => onChange(updateLayer(layers, layer.id, { folderId: f.id }))}
                  >
                    <Folder className="size-3.5" /> Move to {f.name}
                  </DropdownMenuItem>
                ))}
              <DropdownMenuItem
                disabled={layers.layers.length <= 1}
                onSelect={() => deleteLayer(layer)}
                className="text-destructive"
              >
                <Trash2 className="size-3.5" /> Delete layer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {expanded && (
          <ul className="mb-1 ml-8 space-y-0.5">
            {inside.length === 0 && (
              <li className="px-1 text-xs text-muted-foreground">
                {active ? "Draw on the chart to add to this layer." : "No drawings."}
              </li>
            )}
            {inside.map((id) => {
              const drawing = byId.get(id)!;
              return (
                <li
                  key={id}
                  className={cn(
                    "flex items-center gap-1 rounded px-1 text-xs",
                    selectedId === id ? "bg-primary/15" : "hover:bg-accent/40",
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate py-1 text-left"
                    onClick={() => {
                      onRevealDrawings([id]);
                      onSelectDrawing(id);
                    }}
                  >
                    {drawingLabel(drawing.type, drawing.text)}
                  </button>
                  <select
                    aria-label={`Move ${drawingLabel(drawing.type)} to layer`}
                    value={layer.id}
                    onChange={(event) => onChange(assignDrawing(layers, id, event.target.value))}
                    className="max-w-24 shrink-0 truncate rounded border bg-background px-1 py-0.5 text-[11px]"
                  >
                    {layers.layers.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={`Delete ${drawingLabel(drawing.type)}`}
                    onClick={() => onDeleteDrawings([id])}
                    className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  };

  const topLevel = layers.layers.filter((l) => !l.folderId);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            const next = addLayer(layers, "");
            setOpen((current) => new Set([...current, next.activeLayerId]));
            setEditing(next.activeLayerId);
            onChange(next);
          }}
        >
          <Plus /> Layer
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            const next = addFolder(layers, "");
            setEditing(next.folders.at(-1)!.id);
            onChange(next);
          }}
        >
          <FolderPlus /> Folder
        </Button>
      </div>
      <ul className="space-y-0.5">
        {layers.folders.map((folder) => {
          const inside = layers.layers.filter((l) => l.folderId === folder.id);
          const count = inside.reduce((n, l) => n + drawingsIn(layers, l.id, ids).length, 0);
          return (
            <li key={folder.id}>
              <div
                className={cn(
                  "group flex items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium hover:bg-accent/40",
                  !folder.visible && "opacity-60",
                )}
              >
                <button
                  type="button"
                  aria-label={folder.collapsed ? `Open ${folder.name}` : `Close ${folder.name}`}
                  onClick={() =>
                    onChange(updateFolder(layers, folder.id, { collapsed: !folder.collapsed }))
                  }
                  className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                >
                  {folder.collapsed ? (
                    <ChevronRight className="size-3.5" />
                  ) : (
                    <ChevronDown className="size-3.5" />
                  )}
                </button>
                <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                {editing === folder.id ? (
                  <NameInput
                    value={folder.name}
                    label="Folder name"
                    onDone={(name) => {
                      setEditing(null);
                      if (name !== null) onChange(renameFolder(layers, folder.id, name));
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left"
                    onDoubleClick={() => setEditing(folder.id)}
                    onClick={() =>
                      onChange(updateFolder(layers, folder.id, { collapsed: !folder.collapsed }))
                    }
                  >
                    {folder.name}
                  </button>
                )}
                <span className="tnum shrink-0 text-xs font-normal text-muted-foreground">
                  {count}
                </span>
                <IconToggle
                  label={folder.visible ? `Hide ${folder.name}` : `Show ${folder.name}`}
                  on={folder.visible}
                  onIcon={Eye}
                  offIcon={EyeOff}
                  onClick={() =>
                    onChange(updateFolder(layers, folder.id, { visible: !folder.visible }))
                  }
                />
                <IconToggle
                  label={folder.locked ? `Unlock ${folder.name}` : `Lock ${folder.name}`}
                  on={!folder.locked}
                  onIcon={LockOpen}
                  offIcon={Lock}
                  onClick={() =>
                    onChange(updateFolder(layers, folder.id, { locked: !folder.locked }))
                  }
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      aria-label={`${folder.name} options`}
                    >
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-52"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    <DropdownMenuItem
                      onSelect={() => {
                        const next = addLayer(layers, "", folder.id);
                        setOpen((current) => new Set([...current, next.activeLayerId]));
                        setEditing(next.activeLayerId);
                        onChange(next);
                      }}
                    >
                      <Plus className="size-3.5" /> New layer here
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setEditing(folder.id)}>
                      <Pencil className="size-3.5" /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!count}
                      onSelect={() =>
                        onRevealDrawings(inside.flatMap((l) => drawingsIn(layers, l.id, ids)))
                      }
                    >
                      <Crosshair className="size-3.5" /> Show its drawings on the chart
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => onChange(removeFolder(layers, folder.id))}
                      className="text-destructive"
                    >
                      <Trash2 className="size-3.5" /> Delete folder (keep layers)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {!folder.collapsed && (
                <ul className="space-y-0.5">
                  {inside.length === 0 && (
                    <li className="ml-10 text-xs text-muted-foreground">
                      Empty. Use its menu to add a layer.
                    </li>
                  )}
                  {inside.map((layer) => renderLayer(layer, folder))}
                </ul>
              )}
            </li>
          );
        })}
        {topLevel.map((layer) => renderLayer(layer))}
      </ul>
    </div>
  );
}

function IconToggle({
  label,
  on,
  onIcon: OnIcon,
  offIcon: OffIcon,
  onClick,
}: {
  label: string;
  on: boolean;
  onIcon: React.ComponentType<{ className?: string }>;
  offIcon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <HoverHint content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={!on}
        onClick={onClick}
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded hover:bg-accent",
          on ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {on ? <OnIcon className="size-3.5" /> : <OffIcon className="size-3.5" />}
      </button>
    </HoverHint>
  );
}

function NameInput({
  value,
  label,
  onDone,
}: {
  value: string;
  label: string;
  onDone: (name: string | null) => void;
}) {
  const [draft, setDraft] = useState(value);
  // Enter or Escape finish once; the blur that follows must not rename again.
  const [done, setDone] = useState(false);
  const finish = (name: string | null) => {
    if (done) return;
    setDone(true);
    onDone(name);
  };
  return (
    <input
      autoFocus
      aria-label={label}
      value={draft}
      maxLength={80}
      onFocus={(event) => event.target.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(draft);
        if (event.key === "Escape") finish(null);
      }}
      className="h-6 min-w-0 flex-1 rounded border bg-background px-1 text-sm"
    />
  );
}
