"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  CornerDownRight,
  Crosshair,
  Eye,
  EyeOff,
  Focus,
  Folder,
  FolderPlus,
  GripVertical,
  IndentDecrease,
  IndentIncrease,
  Layers,
  Lock,
  LockOpen,
  MoreHorizontal,
  Paintbrush,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import {
  addFolder,
  addLayer,
  ancestorsOf,
  assignDrawings,
  copyNesting,
  descendantsOf,
  drawingName,
  drawingTree,
  drawingsIn,
  effectiveLayer,
  inFocus,
  layerOf,
  nestDrawings,
  parentOf,
  moveLayer,
  placeFolder,
  placeLayer,
  removeFolder,
  removeLayer,
  renameDrawing,
  renameFolder,
  renameLayer,
  setActiveLayer,
  setAllFoldersCollapsed,
  setDrawInto,
  setFocus,
  setLayerColor,
  showEverything,
  soloLayer,
  unlockEverything,
  unnestDrawings,
  updateFolder,
  updateLayer,
  type DrawingLayer,
  type DrawingNode,
  type LayerFolder,
  type LayersDocument,
} from "@/lib/chart-layers";
import { drawingLabel } from "@/lib/chart-analysis";
import { cn } from "@/lib/utils";
import type { ChartDrawing, DrawingPatch } from "./analysis-chart";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { HoverHint } from "./ui/tooltip";

const SWATCHES = ["#2962ff", "#f59e0b", "#e11d48", "#16a34a", "#a855f7", "#737373", "#0ea5e9"];

export interface LayersPanelActions {
  onChange: (next: LayersDocument) => void;
  onRevealDrawings: (ids: string[]) => void;
  onSelectDrawing: (id: string) => void;
  onSelectMany: (ids: string[]) => void;
  onDeleteDrawings: (ids: string[]) => void;
  onUpdateDrawings: (patches: DrawingPatch[]) => void;
  /** Duplicates in place; returns the copies' ids in the same order. */
  onDuplicate: (ids: string[]) => string[];
  onFront: (ids: string[]) => void;
  onBack: (ids: string[]) => void;
  onEditDrawing: (id: string) => void;
}

/**
 * Folders → layers → drawings → drawings inside them (a wave's sub-waves), numbered like an
 * outline. The active layer (the filled dot) receives new drawings, unless you chose a
 * drawing to draw inside.
 * Eye and lock apply to everything inside; a folder's switch overrides its layers. Drag
 * layers to reorder them or into folders, and drawings (one or a checked group) onto a
 * layer; every drag has a menu equivalent for keyboards and touch.
 */
export function LayersPanel({
  layers,
  drawings,
  selectedIds,
  ...actions
}: {
  layers: LayersDocument;
  drawings: ChartDrawing[];
  /** Drawings selected on the chart. */
  selectedIds: string[];
} & LayersPanelActions) {
  const { onChange } = actions;
  const [open, setOpen] = useState<Set<string>>(() => new Set([layers.activeLayerId]));
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  /** Drawings whose contents are folded away in the panel. */
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
  const root = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const ids = drawings.map((d) => d.id);
  const byId = useMemo(() => new Map(drawings.map((d) => [d.id, d])), [drawings]);
  const nameOf = (d: ChartDrawing) => drawingName(layers, d.id) ?? drawingLabel(d.type, d.text);
  const needle = query.trim().toLowerCase();
  const filtering = Boolean(needle || typeFilter);
  const matches = (d: ChartDrawing) =>
    (!typeFilter || d.type === typeFilter) &&
    (!needle || `${nameOf(d)} ${drawingLabel(d.type)} ${d.type}`.toLowerCase().includes(needle));
  const types = [...new Set(drawings.map((d) => d.type))].sort();
  const liveChecked = [...checked].filter((id) => byId.has(id));
  const trees = useMemo(
    () => new Map(layers.layers.map((l) => [l.id, drawingTree(layers, l.id, ids)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layers, drawings],
  );
  const indexOf = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (nodes: DrawingNode[]) =>
      nodes.forEach((n) => {
        map.set(n.id, n.index);
        walk(n.children);
      });
    trees.forEach(walk);
    return map;
  }, [trees]);
  /** A drawing as menus and banners name it: its outline number and name. */
  const labelOf = (id: string) => {
    const drawing = byId.get(id);
    return `${indexOf.get(id) ?? ""} ${drawing ? nameOf(drawing) : "a drawing"}`.trim();
  };

  // A drawing selected on the chart opens its place in the tree and scrolls to it.
  const selectedKey = selectedIds.length === 1 ? selectedIds[0]! : "";
  useEffect(() => {
    if (!selectedKey) return;
    const ups = ancestorsOf(layers, selectedKey);
    setCollapsedNodes((current) =>
      ups.some((u) => current.has(u))
        ? new Set([...current].filter((c) => !ups.includes(c)))
        : current,
    );
    const layerId = layers.assignments[selectedKey];
    if (layerId)
      setOpen((current) => (current.has(layerId) ? current : new Set([...current, layerId])));
    const frame = requestAnimationFrame(() =>
      root.current
        ?.querySelector(`[data-drawing-row="${CSS.escape(selectedKey)}"]`)
        ?.scrollIntoView({ block: "nearest" }),
    );
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const toggleOpen = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Checkbox click; shift extends from the last one through the visible order. */
  const toggleChecked = (id: string, range: boolean, order: string[]) =>
    setChecked((current) => {
      const next = new Set(current);
      if (range && lastChecked && order.includes(lastChecked)) {
        const [a, b] = [order.indexOf(lastChecked), order.indexOf(id)].sort((x, y) => x - y);
        for (const item of order.slice(a!, b! + 1)) next.add(item);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      setLastChecked(id);
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
    if (result.deleteDrawings.length) actions.onDeleteDrawings(result.deleteDrawings);
  };

  const duplicateLayer = (layer: DrawingLayer) => {
    const inside = drawingsIn(layers, layer.id, ids);
    let next = addLayer(layers, `${layer.name} copy`, layer.folderId);
    const copyId = next.activeLayerId;
    if (layer.color) next = setLayerColor(next, copyId, layer.color);
    // The copy sits right under the original.
    const after = layers.layers[layers.layers.indexOf(layer) + 1];
    if (after && after.folderId === layer.folderId)
      next = placeLayer(next, copyId, { beforeId: after.id });
    next = { ...next, activeLayerId: layers.activeLayerId };
    const copies = inside.length ? actions.onDuplicate(inside) : [];
    onChange(copyNesting(assignDrawings(next, copies, copyId), inside, copies));
    setOpen((current) => new Set([...current, copyId]));
  };

  /** Duplicate drawings, each copy in its source's layer and nested like its source. */
  const duplicateDrawings = (sources: string[]) => {
    const copies = actions.onDuplicate(sources);
    let next = layers;
    copies.forEach((copy, i) => {
      const source = sources[i];
      if (source) next = assignDrawings(next, [copy], layerOf(layers, source).id);
    });
    onChange(copyNesting(next, sources, copies));
    setChecked(new Set(copies));
  };

  const setDrawings = (targets: string[], patch: DrawingPatch["patch"]) =>
    actions.onUpdateDrawings(targets.map((id) => ({ id, patch })));

  // ── Drag and drop ──
  const onDragStart = (event: DragStartEvent) => setDragging(String(event.active.id));
  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const source = String(event.active.id);
    const target = event.over ? String(event.over.id) : null;
    if (!target || target === source) return;
    const [kind, id] = split(source);
    const [targetKind, targetId] = split(target);
    if (kind === "drawing") {
      // A checked drawing drags the whole checked group.
      const group = checked.has(id) ? liveChecked : [id];
      if (targetKind === "into") {
        onChange(nestDrawings(layers, group, targetId));
        setCollapsedNodes((current) => new Set([...current].filter((c) => c !== targetId)));
        return;
      }
      if (targetKind !== "layer") return;
      onChange(assignDrawings(layers, group, targetId));
      setOpen((current) => new Set([...current, targetId]));
    } else if (kind === "layer") {
      if (targetKind === "layer") onChange(placeLayer(layers, id, { beforeId: targetId }));
      else if (targetKind === "folder") onChange(placeLayer(layers, id, { folderId: targetId }));
      else if (targetKind === "root") onChange(placeLayer(layers, id, { folderId: null }));
    } else if (kind === "folder" && targetKind === "folder") {
      onChange(placeFolder(layers, id, targetId));
    }
  };

  const toggleNode = (id: string) =>
    setCollapsedNodes((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  /** While filtering, a drawing shows if it or anything inside it matches. */
  const keep = (node: DrawingNode): boolean => {
    const drawing = byId.get(node.id);
    return (Boolean(drawing) && matches(drawing!)) || node.children.some(keep);
  };
  const visibleNodes = (nodes: DrawingNode[]) => (filtering ? nodes.filter(keep) : nodes);
  const nodeOpen = (id: string) => filtering || !collapsedNodes.has(id);
  /** The rows in display order, for shift-click ranges and "All". */
  const flatten = (nodes: DrawingNode[]): string[] =>
    visibleNodes(nodes).flatMap((n) => [n.id, ...(nodeOpen(n.id) ? flatten(n.children) : [])]);

  const renderNode = (
    node: DrawingNode,
    layer: DrawingLayer,
    order: string[],
    siblings: DrawingNode[],
  ): React.ReactNode => {
    const id = node.id;
    const drawing = byId.get(id);
    if (!drawing) return null;
    const layerState = effectiveLayer(layers, layer);
    const name = nameOf(drawing);
    const inside = descendantsOf(layers, id).filter((d) => byId.has(d));
    const tree = [id, ...inside];
    const shownChildren = visibleNodes(node.children);
    const expanded = node.children.length > 0 && nodeOpen(id);
    const above = siblings[siblings.findIndex((s) => s.id === id) - 1];
    const parent = parentOf(layers, id);
    const insideHidden = inside.length > 0 && inside.every((d) => byId.get(d)?.visible === false);
    const focused = layers.focusId === id;
    const target = layers.drawInto === id;
    return (
      <DrawingRow
        key={id}
        id={id}
        index={node.index}
        name={name}
        color={drawing.color}
        selected={selectedIds.includes(id)}
        checked={checked.has(id)}
        visible={drawing.visible}
        locked={drawing.locked}
        forcedHidden={!layerState.visible || !inFocus(layers, id)}
        forcedLocked={layerState.locked}
        editing={editing === `drawing:${id}`}
        insideCount={inside.length}
        expanded={expanded}
        drawInto={target}
        focused={focused}
        dropAccepts={
          dragging !== null && dragging.startsWith("drawing:") && dragging !== `drawing:${id}`
        }
        onToggle={() => toggleNode(id)}
        onStopDrawInto={() => onChange(setDrawInto(layers, null))}
        onCheck={(range) => toggleChecked(id, range, order)}
        onOpen={() => {
          actions.onRevealDrawings(tree);
          actions.onSelectDrawing(id);
        }}
        onRename={(value) => {
          setEditing(null);
          if (value !== null) onChange(renameDrawing(layers, id, value));
        }}
        onStartRename={() => setEditing(`drawing:${id}`)}
        // Eye and lock on a drawing apply to everything inside it.
        onVisible={() => setDrawings(tree, { visible: !drawing.visible })}
        onLocked={() => setDrawings(tree, { locked: !drawing.locked })}
        menu={
          <>
            <DropdownMenuItem onSelect={() => setEditing(`drawing:${id}`)}>
              <Pencil className="size-3.5" /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                actions.onRevealDrawings(tree);
                actions.onSelectDrawing(id);
              }}
            >
              <Crosshair className="size-3.5" />
              {inside.length ? "Go to it and what is inside" : "Go to it on the chart"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                onChange(setFocus(layers, focused ? null : id, drawings));
                if (!focused) actions.onRevealDrawings(tree);
              }}
            >
              <Focus className="size-3.5" />
              {focused ? "Stop focusing" : "Focus on this (hide the rest)"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                onChange(setDrawInto(layers, target ? null : id));
                setCollapsedNodes((current) => new Set([...current].filter((c) => c !== id)));
              }}
            >
              <CornerDownRight className="size-3.5" />
              {target ? "Stop drawing inside this" : "Draw inside this"}
            </DropdownMenuItem>
            {inside.length > 0 && (
              <DropdownMenuItem onSelect={() => setDrawings(inside, { visible: insideHidden })}>
                {insideHidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                {insideHidden ? "Show what is inside" : "Hide what is inside"} ({inside.length})
              </DropdownMenuItem>
            )}
            {above && (
              <DropdownMenuItem
                onSelect={() => {
                  onChange(nestDrawings(layers, [id], above.id));
                  setCollapsedNodes(
                    (current) => new Set([...current].filter((c) => c !== above.id)),
                  );
                }}
              >
                <IndentIncrease className="size-3.5" /> Put inside the one above
              </DropdownMenuItem>
            )}
            {parent && (
              <DropdownMenuItem onSelect={() => onChange(unnestDrawings(layers, [id]))}>
                <IndentDecrease className="size-3.5" /> Take out of {labelOf(parent)}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => actions.onEditDrawing(id)}>
              <SlidersHorizontal className="size-3.5" /> Edit style on the chart
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.onFront([id])}>
              <ArrowUpToLine className="size-3.5" /> Bring to front
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.onBack([id])}>
              <ArrowDownToLine className="size-3.5" /> Send to back
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => duplicateDrawings([id])}>
              <Copy className="size-3.5" /> Duplicate
            </DropdownMenuItem>
            {inside.length > 0 && (
              <DropdownMenuItem onSelect={() => duplicateDrawings(tree)}>
                <Copy className="size-3.5" /> Duplicate with what is inside
              </DropdownMenuItem>
            )}
            {layers.layers
              .filter((l) => l.id !== layer.id)
              .map((l) => (
                <DropdownMenuItem
                  key={l.id}
                  onSelect={() => onChange(assignDrawings(layers, [id], l.id))}
                >
                  <Layers className="size-3.5" /> Move to {l.name}
                </DropdownMenuItem>
              ))}
            <DropdownMenuItem
              className="text-destructive"
              onSelect={() => actions.onDeleteDrawings([id])}
            >
              <Trash2 className="size-3.5" />
              {inside.length ? "Delete (keep what is inside)" : "Delete"}
            </DropdownMenuItem>
            {inside.length > 0 && (
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() => {
                  if (confirm(`Delete ${name} and the ${inside.length} drawings inside it?`))
                    actions.onDeleteDrawings(tree);
                }}
              >
                <Trash2 className="size-3.5" /> Delete with what is inside ({inside.length})
              </DropdownMenuItem>
            )}
          </>
        }
      >
        {expanded && shownChildren.length > 0 && (
          <ul className="ml-3 space-y-0.5 border-l pl-1">
            {shownChildren.map((child) => renderNode(child, layer, order, node.children))}
          </ul>
        )}
      </DrawingRow>
    );
  };

  const renderLayer = (layer: DrawingLayer, folder?: LayerFolder) => {
    const inside = drawingsIn(layers, layer.id, ids);
    const shown = inside.map((id) => byId.get(id)!).filter((d) => d && matches(d));
    if (filtering && !shown.length && !layer.name.toLowerCase().includes(needle)) return null;
    const effective = effectiveLayer(layers, layer);
    const active = layers.activeLayerId === layer.id;
    const expanded = open.has(layer.id) || (filtering && shown.length > 0);
    const hiddenCount = inside.filter((id) => byId.get(id)?.visible === false).length;
    const tree = trees.get(layer.id) ?? [];
    const order = flatten(tree);
    const allChecked = order.length > 0 && order.every((id) => checked.has(id));
    return (
      <li key={layer.id} className={cn(folder && "ml-4")}>
        <DropTarget
          id={`layer:${layer.id}`}
          accepts={dragging !== null && !dragging.startsWith("folder:")}
        >
          <DragHandleRow
            id={`layer:${layer.id}`}
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
            <HoverHint
              content={active ? "Active layer: new drawings go here" : "Draw on this layer"}
            >
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
                  style={
                    layer.color
                      ? {
                          borderColor: layer.color,
                          ...(active ? { backgroundColor: layer.color } : {}),
                        }
                      : undefined
                  }
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
            <span
              className="tnum shrink-0 text-xs text-muted-foreground"
              title={hiddenCount ? `${hiddenCount} hidden` : undefined}
            >
              {filtering ? `${shown.length}/` : ""}
              {inside.length}
              {hiddenCount ? ` · ${hiddenCount} hidden` : ""}
            </span>
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
                className="w-60"
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
                <DropdownMenuItem onSelect={() => setEditing(layer.id)}>
                  <Pencil className="size-3.5" /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onChange(soloLayer(layers, layer.id))}>
                  <Focus className="size-3.5" /> Show only this layer
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!inside.length}
                  onSelect={() => actions.onRevealDrawings(inside)}
                >
                  <Crosshair className="size-3.5" /> Show its drawings on the chart
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!inside.length}
                  onSelect={() => setChecked(new Set(inside))}
                >
                  <Layers className="size-3.5" /> Check its drawings
                </DropdownMenuItem>
                <div className="px-2 py-1.5">
                  <p className="mb-1 text-[11px] text-muted-foreground">Layer colour</p>
                  <ColorRow
                    value={layer.color}
                    onPick={(color) => onChange(setLayerColor(layers, layer.id, color))}
                    onClear={
                      layer.color
                        ? () => onChange(setLayerColor(layers, layer.id, null))
                        : undefined
                    }
                  />
                </div>
                <DropdownMenuItem
                  disabled={!layer.color || !inside.length}
                  onSelect={() =>
                    layer.color && setDrawings(inside, { style: { lineColor: layer.color } })
                  }
                >
                  <Paintbrush className="size-3.5" /> Colour its drawings with it
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => duplicateLayer(layer)}>
                  <Copy className="size-3.5" /> Duplicate layer with drawings
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
          </DragHandleRow>
        </DropTarget>
        {expanded && (
          <ul className="mb-1 ml-6 space-y-0.5">
            {order.length > 1 && (
              <li className="px-1">
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={() =>
                      setChecked((current) => {
                        const next = new Set(current);
                        for (const id of order) {
                          if (allChecked) next.delete(id);
                          else next.add(id);
                        }
                        return next;
                      })
                    }
                  />
                  All {order.length}
                </label>
              </li>
            )}
            {inside.length === 0 && (
              <li className="px-1 text-xs text-muted-foreground">
                {active
                  ? "Draw on the chart to add to this layer."
                  : "No drawings. Drag some here."}
              </li>
            )}
            {visibleNodes(tree).map((node) => renderNode(node, layer, order, tree))}
          </ul>
        )}
      </li>
    );
  };

  const topLevel = layers.layers.filter((l) => !l.folderId);
  const anyCollapsed = layers.folders.some((f) => f.collapsed);
  return (
    <div ref={root} className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
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
        <span className="ml-auto flex items-center">
          <IconButton
            label="Show every layer"
            icon={Eye}
            onClick={() => onChange(showEverything(layers))}
          />
          <IconButton
            label="Unlock every layer"
            icon={LockOpen}
            onClick={() => onChange(unlockEverything(layers))}
          />
          <IconButton
            label={anyCollapsed ? "Open all folders and layers" : "Close all folders and layers"}
            icon={anyCollapsed ? ChevronsUpDown : ChevronsDownUp}
            onClick={() => {
              onChange(setAllFoldersCollapsed(layers, !anyCollapsed));
              setOpen(anyCollapsed ? new Set(layers.layers.map((l) => l.id)) : new Set());
            }}
          />
        </span>
      </div>
      {(layers.focusId || layers.drawInto) && (
        <div
          role="status"
          className="space-y-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5 text-xs"
        >
          {layers.focusId && (
            <p className="flex items-center gap-1.5">
              <Focus aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                Focused on <strong>{labelOf(layers.focusId)}</strong>: only it and what is inside
                show{layers.drawInto ? "" : ", and new drawings go inside it"}.
              </span>
              <button
                type="button"
                className="shrink-0 underline"
                onClick={() => onChange(setFocus(layers, null, drawings))}
              >
                Show everything
              </button>
            </p>
          )}
          {layers.drawInto && (
            <p className="flex items-center gap-1.5">
              <CornerDownRight aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                New drawings go inside <strong>{labelOf(layers.drawInto)}</strong>.
              </span>
              <button
                type="button"
                className="shrink-0 underline"
                onClick={() => onChange(setDrawInto(layers, null))}
              >
                Stop
              </button>
            </p>
          )}
        </div>
      )}
      {drawings.length > 0 && (
        <div className="flex gap-1">
          <label className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find drawings"
              aria-label="Find drawings by name or type"
              className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-sm"
            />
          </label>
          <select
            aria-label="Filter by drawing type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-8 max-w-32 rounded-md border bg-background px-1 text-xs"
          >
            <option value="">All types</option>
            {types.map((type) => (
              <option key={type} value={type}>
                {drawingLabel(type)}
              </option>
            ))}
          </select>
        </div>
      )}
      {liveChecked.length > 0 && (
        <BulkBar
          count={liveChecked.length}
          layers={layers.layers}
          onClear={() => setChecked(new Set())}
          onSelectOnChart={() => actions.onSelectMany(liveChecked)}
          onReveal={() => actions.onRevealDrawings(liveChecked)}
          onVisible={(visible) => setDrawings(liveChecked, { visible })}
          onLocked={(locked) => setDrawings(liveChecked, { locked })}
          onMove={(layer) => onChange(assignDrawings(layers, liveChecked, layer))}
          nestTargets={[...indexOf.keys()]
            .filter((id) => !checked.has(id) && byId.has(id))
            .map((id) => ({ id, label: labelOf(id) }))}
          onNest={(parent) => onChange(nestDrawings(layers, liveChecked, parent))}
          onUnnest={() => onChange(unnestDrawings(layers, liveChecked))}
          onStyle={(style) => setDrawings(liveChecked, { style })}
          onFront={() => actions.onFront(liveChecked)}
          onBack={() => actions.onBack(liveChecked)}
          onDuplicate={() => duplicateDrawings(liveChecked)}
          onDelete={() => {
            if (
              !confirm(
                `Delete ${liveChecked.length} drawing${liveChecked.length === 1 ? "" : "s"}?`,
              )
            )
              return;
            actions.onDeleteDrawings(liveChecked);
            setChecked(new Set());
          }}
        />
      )}
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <ul className="space-y-0.5">
          {layers.folders.map((folder) => {
            const inside = layers.layers.filter((l) => l.folderId === folder.id);
            const count = inside.reduce((n, l) => n + drawingsIn(layers, l.id, ids).length, 0);
            const rendered = inside.map((layer) => renderLayer(layer, folder)).filter(Boolean);
            if (filtering && !rendered.length) return null;
            const expanded = !folder.collapsed || filtering;
            return (
              <li key={folder.id}>
                <DropTarget
                  id={`folder:${folder.id}`}
                  accepts={dragging !== null && !dragging.startsWith("drawing:")}
                >
                  <DragHandleRow
                    id={`folder:${folder.id}`}
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
                      {expanded ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </button>
                    <Folder
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
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
                          onChange(
                            updateFolder(layers, folder.id, { collapsed: !folder.collapsed }),
                          )
                        }
                      >
                        {folder.name}
                      </button>
                    )}
                    <span className="tnum shrink-0 text-xs font-normal text-muted-foreground">
                      {inside.length} · {count}
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
                        className="w-56"
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
                          onSelect={() =>
                            onChange({
                              ...layers,
                              layers: layers.layers.map((l) => ({
                                ...l,
                                visible: l.folderId === folder.id,
                              })),
                              folders: layers.folders.map((f) => ({
                                ...f,
                                visible: f.id === folder.id ? true : f.visible,
                              })),
                            })
                          }
                        >
                          <Focus className="size-3.5" /> Show only this folder
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!count}
                          onSelect={() =>
                            actions.onRevealDrawings(
                              inside.flatMap((l) => drawingsIn(layers, l.id, ids)),
                            )
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
                  </DragHandleRow>
                </DropTarget>
                {expanded && (
                  <ul className="space-y-0.5">
                    {inside.length === 0 && (
                      <li className="ml-10 text-xs text-muted-foreground">
                        Empty. Drag a layer here or use its menu.
                      </li>
                    )}
                    {rendered}
                  </ul>
                )}
              </li>
            );
          })}
          {topLevel.map((layer) => renderLayer(layer))}
        </ul>
        {layers.folders.length > 0 && (
          <DropTarget id="root" accepts={dragging?.startsWith("layer:") ?? false}>
            <p
              className={cn(
                "rounded-md border border-dashed px-2 py-1 text-center text-[11px] text-muted-foreground",
                !dragging?.startsWith("layer:") && "hidden",
              )}
            >
              Drop here to take the layer out of its folder
            </p>
          </DropTarget>
        )}
        <DragOverlay>
          {dragging && (
            <div className="rounded-md border bg-card px-2 py-1 text-xs shadow-lg">
              {dragLabel(dragging, layers, byId, nameOf, checked)}
            </div>
          )}
        </DragOverlay>
      </DndContext>
      {filtering && (
        <p className="text-[11px] text-muted-foreground">
          Showing drawings that match.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              setQuery("");
              setTypeFilter("");
            }}
          >
            Clear
          </button>
        </p>
      )}
    </div>
  );
}

const split = (dragId: string): [string, string] => {
  const i = dragId.indexOf(":");
  return i < 0 ? [dragId, ""] : [dragId.slice(0, i), dragId.slice(i + 1)];
};

function dragLabel(
  dragId: string,
  doc: LayersDocument,
  byId: Map<string, ChartDrawing>,
  nameOf: (d: ChartDrawing) => string,
  checked: Set<string>,
) {
  const [kind, id] = split(dragId);
  if (kind === "layer") return doc.layers.find((l) => l.id === id)?.name ?? "Layer";
  if (kind === "folder") return doc.folders.find((f) => f.id === id)?.name ?? "Folder";
  const drawing = byId.get(id);
  if (checked.has(id) && checked.size > 1) return `${checked.size} drawings`;
  return drawing ? nameOf(drawing) : "Drawing";
}

function DropTarget({
  id,
  accepts,
  children,
}: {
  id: string;
  accepts: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !accepts });
  return (
    <div ref={setNodeRef} className={cn("rounded-md", isOver && accepts && "ring-2 ring-primary")}>
      {children}
    </div>
  );
}

/** A row whose grip starts a drag; the rest of the row stays clickable. */
function DragHandleRow({
  id,
  className,
  children,
}: {
  id: string;
  className: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <div ref={setNodeRef} className={cn(className, isDragging && "opacity-40")}>
      <button
        type="button"
        aria-label="Drag to move"
        className="flex h-6 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/60 hover:text-foreground"
        {...listeners}
        {...attributes}
      >
        <GripVertical className="size-3" />
      </button>
      {children}
    </div>
  );
}

function DrawingRow({
  id,
  index,
  name,
  color,
  selected,
  checked,
  visible,
  locked,
  forcedHidden,
  forcedLocked,
  editing,
  insideCount,
  expanded,
  drawInto,
  focused,
  dropAccepts,
  onToggle,
  onStopDrawInto,
  onCheck,
  onOpen,
  onRename,
  onStartRename,
  onVisible,
  onLocked,
  menu,
  children,
}: {
  id: string;
  /** Outline number within its layer: 1, 1.2, 1.2.3. */
  index: string;
  name: string;
  color?: string;
  selected: boolean;
  checked: boolean;
  visible: boolean;
  locked: boolean;
  forcedHidden: boolean;
  forcedLocked: boolean;
  editing: boolean;
  /** Drawings inside this one, at any depth. */
  insideCount: number;
  expanded: boolean;
  /** New drawings go inside this one. */
  drawInto: boolean;
  focused: boolean;
  /** A drawing being dragged can be dropped here to go inside this one. */
  dropAccepts: boolean;
  onToggle: () => void;
  onStopDrawInto: () => void;
  onCheck: (range: boolean) => void;
  onOpen: () => void;
  onRename: (name: string | null) => void;
  onStartRename: () => void;
  onVisible: () => void;
  onLocked: () => void;
  menu: React.ReactNode;
  children?: React.ReactNode;
}) {
  const hasInside = insideCount > 0;
  return (
    <li data-drawing-row={id}>
      <DropTarget id={`into:${id}`} accepts={dropAccepts}>
        <DragHandleRow
          id={`drawing:${id}`}
          className={cn(
            "flex items-center gap-1 rounded px-1 text-xs",
            selected ? "bg-primary/15" : checked ? "bg-accent/60" : "hover:bg-accent/40",
            (drawInto || focused) && "ring-1 ring-primary/60",
            !visible && "opacity-60",
          )}
        >
          <input
            type="checkbox"
            aria-label={`Check ${name}`}
            checked={checked}
            onChange={() => undefined}
            onClick={(e) => onCheck(e.shiftKey)}
            className="shrink-0"
          />
          {hasInside ? (
            <button
              type="button"
              aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
              aria-expanded={expanded}
              onClick={onToggle}
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </button>
          ) : (
            <span aria-hidden="true" className="size-5 shrink-0" />
          )}
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full border"
            style={color ? { backgroundColor: color, borderColor: color } : undefined}
          />
          <span className="tnum shrink-0 text-[10px] text-muted-foreground">{index}</span>
          {editing ? (
            <NameInput value={name} label="Drawing name" onDone={onRename} />
          ) : (
            <button
              type="button"
              className="min-w-0 flex-1 truncate py-1 text-left"
              onClick={onOpen}
              onDoubleClick={onStartRename}
            >
              {name}
              {hasInside && !expanded && (
                <span className="tnum ml-1 text-muted-foreground">+{insideCount}</span>
              )}
            </button>
          )}
          {focused && (
            <HoverHint content="Focused: only this and what is inside show">
              <Focus aria-label="Focused" className="size-3 shrink-0 text-primary" />
            </HoverHint>
          )}
          {drawInto && (
            <HoverHint content="New drawings go inside this. Click to stop.">
              <button
                type="button"
                aria-label={`Stop drawing inside ${name}`}
                onClick={onStopDrawInto}
                className="flex size-6 shrink-0 items-center justify-center rounded text-primary hover:bg-accent"
              >
                <CornerDownRight className="size-3" />
              </button>
            </HoverHint>
          )}
          <IconToggle
            small
            label={
              forcedHidden
                ? "Hidden by its layer or the focus"
                : visible
                  ? `Hide ${name}${hasInside ? " and what is inside" : ""}`
                  : `Show ${name}${hasInside ? " and what is inside" : ""}`
            }
            on={visible}
            disabled={forcedHidden}
            onIcon={Eye}
            offIcon={EyeOff}
            onClick={onVisible}
          />
          <IconToggle
            small
            label={
              forcedLocked
                ? "Locked by its layer"
                : locked
                  ? `Unlock ${name}${hasInside ? " and what is inside" : ""}`
                  : `Lock ${name}${hasInside ? " and what is inside" : ""}`
            }
            on={!locked}
            disabled={forcedLocked}
            onIcon={LockOpen}
            offIcon={Lock}
            onClick={onLocked}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`${name} options`}
                className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                <MoreHorizontal className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-64"
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              {menu}
            </DropdownMenuContent>
          </DropdownMenu>
        </DragHandleRow>
      </DropTarget>
      {children}
    </li>
  );
}

function BulkBar({
  count,
  layers,
  onClear,
  onSelectOnChart,
  onReveal,
  onVisible,
  onLocked,
  onMove,
  nestTargets,
  onNest,
  onUnnest,
  onStyle,
  onFront,
  onBack,
  onDuplicate,
  onDelete,
}: {
  count: number;
  layers: DrawingLayer[];
  onClear: () => void;
  onSelectOnChart: () => void;
  onReveal: () => void;
  onVisible: (visible: boolean) => void;
  onLocked: (locked: boolean) => void;
  onMove: (layer: string) => void;
  /** Drawings the checked ones can go inside, labelled with their outline number. */
  nestTargets: { id: string; label: string }[];
  onNest: (parent: string) => void;
  onUnnest: () => void;
  onStyle: (style: Record<string, unknown>) => void;
  onFront: () => void;
  onBack: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Checked drawings"
      className="space-y-1.5 rounded-md border bg-accent/30 p-2 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          {count} drawing{count === 1 ? "" : "s"} checked
        </span>
        <button
          type="button"
          aria-label="Uncheck all"
          className="text-muted-foreground hover:text-foreground"
          onClick={onClear}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        <IconButton label="Select them on the chart" icon={Crosshair} onClick={onSelectOnChart} />
        <IconButton label="Scroll the chart to them" icon={Focus} onClick={onReveal} />
        <IconButton label="Show" icon={Eye} onClick={() => onVisible(true)} />
        <IconButton label="Hide" icon={EyeOff} onClick={() => onVisible(false)} />
        <IconButton label="Lock" icon={Lock} onClick={() => onLocked(true)} />
        <IconButton label="Unlock" icon={LockOpen} onClick={() => onLocked(false)} />
        <IconButton label="Bring to front" icon={ArrowUpToLine} onClick={onFront} />
        <IconButton label="Send to back" icon={ArrowDownToLine} onClick={onBack} />
        <IconButton label="Duplicate" icon={Copy} onClick={onDuplicate} />
        <IconButton label="Take out one level" icon={IndentDecrease} onClick={onUnnest} />
        <IconButton label="Delete" icon={Trash2} onClick={onDelete} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Move checked drawings to layer"
          value=""
          onChange={(e) => e.target.value && onMove(e.target.value)}
          className="h-7 rounded border bg-background px-1"
        >
          <option value="">Move to layer…</option>
          {layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        {nestTargets.length > 0 && (
          <select
            aria-label="Put checked drawings inside another drawing"
            value=""
            onChange={(e) => e.target.value && onNest(e.target.value)}
            className="h-7 max-w-40 rounded border bg-background px-1"
          >
            <option value="">Put inside…</option>
            {nestTargets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        )}
        <ColorRow onPick={(color) => onStyle({ lineColor: color })} />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-muted-foreground">Width</span>
        {[1, 2, 3, 4].map((width) => (
          <button
            key={width}
            type="button"
            aria-label={`Width ${width}`}
            onClick={() => onStyle({ lineWidth: width })}
            className="flex h-6 w-7 items-center justify-center rounded border hover:bg-accent"
          >
            <span className="block w-4 rounded-full bg-foreground" style={{ height: width }} />
          </button>
        ))}
        <span className="ml-2 text-muted-foreground">Line</span>
        {(["solid", "dashed", "dotted"] as const).map((lineStyle) => (
          <button
            key={lineStyle}
            type="button"
            onClick={() => onStyle({ lineStyle })}
            className="h-6 rounded border px-1.5 capitalize hover:bg-accent"
          >
            {lineStyle}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Colour swatches plus a picker for any colour. */
function ColorRow({
  value,
  onPick,
  onClear,
}: {
  value?: string;
  onPick: (color: string) => void;
  onClear?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {SWATCHES.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Colour ${color}`}
          aria-pressed={value === color}
          onClick={() => onPick(color)}
          className={cn(
            "size-5 rounded-full border-2",
            value === color ? "border-foreground" : "border-transparent",
          )}
          style={{ backgroundColor: color }}
        />
      ))}
      <label
        className="relative flex size-5 cursor-pointer items-center justify-center rounded-full border border-dashed"
        title="Any colour"
      >
        <Plus className="size-3" aria-hidden="true" />
        <input
          type="color"
          aria-label="Pick any colour"
          value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#2962ff"}
          onChange={(e) => onPick(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      {onClear && (
        <button type="button" className="ml-1 text-[11px] underline" onClick={onClear}>
          None
        </button>
      )}
    </div>
  );
}

function IconButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <HoverHint content={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Icon className="size-3.5" />
      </button>
    </HoverHint>
  );
}

function IconToggle({
  label,
  on,
  onIcon: OnIcon,
  offIcon: OffIcon,
  onClick,
  disabled,
  small,
}: {
  label: string;
  on: boolean;
  onIcon: React.ComponentType<{ className?: string }>;
  offIcon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  small?: boolean;
}) {
  return (
    <HoverHint content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={!on}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "flex shrink-0 items-center justify-center rounded hover:bg-accent disabled:opacity-40",
          small ? "size-6" : "size-7",
          on ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {on ? (
          <OnIcon className={small ? "size-3" : "size-3.5"} />
        ) : (
          <OffIcon className={small ? "size-3" : "size-3.5"} />
        )}
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
