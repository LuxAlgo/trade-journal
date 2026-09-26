/**
 * Drawing layers for chart analyses: folders hold layers, layers hold drawings. Layers own
 * visibility and locking; a drawing hidden or locked by its layer is enforced on the chart.
 * Everything here is pure so the chart, the panel and the server agree on one model.
 */

export interface LayerFolder {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  collapsed: boolean;
}

export interface DrawingLayer {
  id: string;
  name: string;
  /** null keeps the layer at the top level, outside any folder. */
  folderId: string | null;
  visible: boolean;
  locked: boolean;
  /** Colour tag shown in the panel, and applied to its drawings on request. */
  color?: string;
}

export interface LayersDocument {
  version: 1;
  folders: LayerFolder[];
  layers: DrawingLayer[];
  /** New drawings land here. */
  activeLayerId: string;
  /** Vela drawing id → layer id. */
  assignments: Record<string, string>;
  /** Vela drawing id → a name you gave it in the panel. */
  names?: Record<string, string>;
}

export const MAX_FOLDERS = 50;
export const MAX_LAYERS = 200;
export const MAX_LAYER_NAME = 80;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_LAYER_ID = "layer-main";

export const defaultLayers = (): LayersDocument => ({
  version: 1,
  folders: [],
  layers: [{ id: DEFAULT_LAYER_ID, name: "Main", folderId: null, visible: true, locked: false }],
  activeLayerId: DEFAULT_LAYER_ID,
  assignments: {},
});

const cleanName = (name: string, fallback: string) =>
  name
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, MAX_LAYER_NAME) || fallback;

let counter = 0;
/** Short unique id; collisions are also checked against the document. */
export function layerId(prefix: "layer" | "folder", doc: LayersDocument): string {
  const taken = new Set([...doc.layers.map((l) => l.id), ...doc.folders.map((f) => f.id)]);
  for (;;) {
    counter += 1;
    const id = `${prefix}-${Date.now().toString(36)}${counter.toString(36)}`;
    if (!taken.has(id)) return id;
  }
}

/** Shape problems for a stored document, or null when it is valid. */
export function layersProblem(value: unknown): string | null {
  if (!value || typeof value !== "object") return "Layers must be a document.";
  const doc = value as Partial<LayersDocument>;
  if (doc.version !== 1 || !Array.isArray(doc.folders) || !Array.isArray(doc.layers))
    return "Unsupported layers document.";
  if (doc.folders.length > MAX_FOLDERS) return `Keep at most ${MAX_FOLDERS} folders.`;
  if (doc.layers.length === 0 || doc.layers.length > MAX_LAYERS)
    return `Keep between 1 and ${MAX_LAYERS} layers.`;
  const folderIds = new Set<string>();
  for (const f of doc.folders as unknown[]) {
    const folder = f as Partial<LayerFolder> | null;
    if (!folder || typeof folder.id !== "string" || !ID.test(folder.id) || folderIds.has(folder.id))
      return "A folder has an invalid id.";
    if (typeof folder.name !== "string" || folder.name.length > MAX_LAYER_NAME)
      return "A folder has an invalid name.";
    if (![folder.visible, folder.locked, folder.collapsed].every((v) => typeof v === "boolean"))
      return "A folder has invalid settings.";
    folderIds.add(folder.id);
  }
  const layerIds = new Set<string>();
  for (const l of doc.layers as unknown[]) {
    const layer = l as Partial<DrawingLayer> | null;
    if (!layer || typeof layer.id !== "string" || !ID.test(layer.id) || layerIds.has(layer.id))
      return "A layer has an invalid id.";
    if (folderIds.has(layer.id)) return "Layer and folder ids must differ.";
    if (typeof layer.name !== "string" || layer.name.length > MAX_LAYER_NAME)
      return "A layer has an invalid name.";
    if (layer.folderId !== null && !folderIds.has(layer.folderId as string))
      return "A layer belongs to a missing folder.";
    if (typeof layer.visible !== "boolean" || typeof layer.locked !== "boolean")
      return "A layer has invalid settings.";
    if (layer.color !== undefined && !(typeof layer.color === "string" && HEX.test(layer.color)))
      return "A layer has an invalid colour.";
    layerIds.add(layer.id);
  }
  if (typeof doc.activeLayerId !== "string" || !layerIds.has(doc.activeLayerId))
    return "The active layer is missing.";
  if (!doc.assignments || typeof doc.assignments !== "object" || Array.isArray(doc.assignments))
    return "Layer assignments are invalid.";
  const entries = Object.entries(doc.assignments);
  if (entries.length > 5000) return "Too many layer assignments.";
  for (const [drawing, layer] of entries)
    if (drawing.length > 100 || typeof layer !== "string" || !layerIds.has(layer))
      return "A drawing is assigned to a missing layer.";
  if (doc.names !== undefined) {
    if (!doc.names || typeof doc.names !== "object" || Array.isArray(doc.names))
      return "Drawing names are invalid.";
    const names = Object.entries(doc.names);
    if (names.length > 5000) return "Too many drawing names.";
    for (const [drawing, name] of names)
      if (drawing.length > 100 || typeof name !== "string" || name.length > MAX_LAYER_NAME)
        return "A drawing name is invalid.";
  }
  return null;
}

export const parseLayers = (json: string | null | undefined): LayersDocument => {
  if (!json) return defaultLayers();
  try {
    const value = JSON.parse(json) as unknown;
    return layersProblem(value) ? defaultLayers() : (value as LayersDocument);
  } catch {
    return defaultLayers();
  }
};

/**
 * Keep assignments in step with the drawings on the chart: drop ones for deleted drawings
 * and give unassigned drawings (older analyses, Vela-side creations) the active layer.
 */
export function syncAssignments(doc: LayersDocument, drawingIds: string[]): LayersDocument {
  const present = new Set(drawingIds);
  const assignments: Record<string, string> = {};
  let changed = false;
  for (const [drawing, layer] of Object.entries(doc.assignments)) {
    if (present.has(drawing)) assignments[drawing] = layer;
    else changed = true;
  }
  for (const id of drawingIds)
    if (!assignments[id]) {
      assignments[id] = doc.activeLayerId;
      changed = true;
    }
  let names = doc.names;
  if (names && Object.keys(names).some((id) => !present.has(id))) {
    names = Object.fromEntries(Object.entries(names).filter(([id]) => present.has(id)));
    changed = true;
  }
  return changed ? { ...doc, assignments, ...(names ? { names } : {}) } : doc;
}

export const layerOf = (doc: LayersDocument, drawingId: string) =>
  doc.layers.find((l) => l.id === (doc.assignments[drawingId] ?? doc.activeLayerId)) ??
  doc.layers[0]!;

const folderOf = (doc: LayersDocument, layer: DrawingLayer) =>
  layer.folderId ? doc.folders.find((f) => f.id === layer.folderId) : undefined;

/** A layer shows only when it and its folder are visible; either lock locks it. */
export function effectiveLayer(doc: LayersDocument, layer: DrawingLayer) {
  const folder = folderOf(doc, layer);
  return {
    visible: layer.visible && (folder?.visible ?? true),
    locked: layer.locked || (folder?.locked ?? false),
  };
}

/**
 * The visibility/lock each drawing must have. `previous` is the document before a change:
 * a drawing moving out of a hidden or locked state is restored; otherwise a drawing keeps
 * its own lock (set from its settings popup) unless the layer forces it.
 */
export function drawingStates(
  doc: LayersDocument,
  drawings: { id: string; visible: boolean; locked: boolean }[],
  previous?: LayersDocument,
): { id: string; visible: boolean; locked: boolean }[] {
  const patches: { id: string; visible: boolean; locked: boolean }[] = [];
  for (const drawing of drawings) {
    const now = effectiveLayer(doc, layerOf(doc, drawing.id));
    const before = previous ? effectiveLayer(previous, layerOf(previous, drawing.id)) : now;
    const visible = !now.visible ? false : !before.visible ? true : drawing.visible;
    const locked = now.locked ? true : before.locked ? false : drawing.locked;
    if (visible !== drawing.visible || locked !== drawing.locked)
      patches.push({ id: drawing.id, visible, locked });
  }
  return patches;
}

// ── Operations: each returns a new document ──

export function addLayer(doc: LayersDocument, name: string, folderId: string | null = null) {
  if (doc.layers.length >= MAX_LAYERS) return doc;
  const id = layerId("layer", doc);
  const folder = folderId && doc.folders.some((f) => f.id === folderId) ? folderId : null;
  return {
    ...doc,
    layers: [
      ...doc.layers,
      {
        id,
        name: cleanName(name, `Layer ${doc.layers.length + 1}`),
        folderId: folder,
        visible: true,
        locked: false,
      },
    ],
    // A new layer becomes where the next drawings go, and its folder opens to show it.
    activeLayerId: id,
    folders: doc.folders.map((f) => (f.id === folder ? { ...f, collapsed: false } : f)),
  };
}

export function addFolder(doc: LayersDocument, name: string) {
  if (doc.folders.length >= MAX_FOLDERS) return doc;
  const folder: LayerFolder = {
    id: layerId("folder", doc),
    name: cleanName(name, `Folder ${doc.folders.length + 1}`),
    visible: true,
    locked: false,
    collapsed: false,
  };
  return { ...doc, folders: [...doc.folders, folder] };
}

export const renameLayer = (doc: LayersDocument, id: string, name: string) => ({
  ...doc,
  layers: doc.layers.map((l) => (l.id === id ? { ...l, name: cleanName(name, l.name) } : l)),
});

export const renameFolder = (doc: LayersDocument, id: string, name: string) => ({
  ...doc,
  folders: doc.folders.map((f) => (f.id === id ? { ...f, name: cleanName(name, f.name) } : f)),
});

export const updateLayer = (
  doc: LayersDocument,
  id: string,
  patch: Partial<Pick<DrawingLayer, "visible" | "locked" | "folderId">>,
) => ({
  ...doc,
  layers: doc.layers.map((l) =>
    l.id === id
      ? {
          ...l,
          ...patch,
          folderId:
            patch.folderId === undefined
              ? l.folderId
              : patch.folderId && doc.folders.some((f) => f.id === patch.folderId)
                ? patch.folderId
                : null,
        }
      : l,
  ),
});

export const updateFolder = (
  doc: LayersDocument,
  id: string,
  patch: Partial<Pick<LayerFolder, "visible" | "locked" | "collapsed">>,
) => ({ ...doc, folders: doc.folders.map((f) => (f.id === id ? { ...f, ...patch } : f)) });

/**
 * Where new drawings go. Choosing a hidden or locked layer reveals and unlocks it (and
 * its folder), so a new drawing is never invisible or frozen the moment it is made.
 */
export function setActiveLayer(doc: LayersDocument, id: string): LayersDocument {
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer) return doc;
  return {
    ...doc,
    activeLayerId: id,
    layers: doc.layers.map((l) => (l.id === id ? { ...l, visible: true, locked: false } : l)),
    folders: doc.folders.map((f) =>
      f.id === layer.folderId ? { ...f, visible: true, locked: false } : f,
    ),
  };
}

export const assignDrawing = (doc: LayersDocument, drawingId: string, layer: string) =>
  doc.layers.some((l) => l.id === layer)
    ? { ...doc, assignments: { ...doc.assignments, [drawingId]: layer } }
    : doc;

/** Drawings a layer holds, in chart order. */
export const drawingsIn = (doc: LayersDocument, layer: string, drawingIds: string[]) =>
  drawingIds.filter((id) => (doc.assignments[id] ?? doc.activeLayerId) === layer);

/**
 * Remove a layer. Its drawings move to `moveTo`, or are returned for deletion when it is
 * null. The last layer cannot be removed.
 */
export function removeLayer(
  doc: LayersDocument,
  id: string,
  moveTo: string | null,
): { doc: LayersDocument; deleteDrawings: string[] } {
  if (doc.layers.length <= 1 || !doc.layers.some((l) => l.id === id))
    return { doc, deleteDrawings: [] };
  const layers = doc.layers.filter((l) => l.id !== id);
  const target = moveTo && layers.some((l) => l.id === moveTo) ? moveTo : null;
  const assignments: Record<string, string> = {};
  const deleteDrawings: string[] = [];
  for (const [drawing, layer] of Object.entries(doc.assignments)) {
    if (layer !== id) assignments[drawing] = layer;
    else if (target) assignments[drawing] = target;
    else deleteDrawings.push(drawing);
  }
  const activeLayerId = doc.activeLayerId === id ? (target ?? layers[0]!.id) : doc.activeLayerId;
  return { doc: { ...doc, layers, assignments, activeLayerId }, deleteDrawings };
}

/** Remove a folder; its layers stay, moved to the top level. */
export const removeFolder = (doc: LayersDocument, id: string): LayersDocument => ({
  ...doc,
  folders: doc.folders.filter((f) => f.id !== id),
  layers: doc.layers.map((l) => (l.folderId === id ? { ...l, folderId: null } : l)),
});

/** Move a layer one step within the list (the panel's up/down buttons). */
export function moveLayer(doc: LayersDocument, id: string, direction: -1 | 1): LayersDocument {
  const index = doc.layers.findIndex((l) => l.id === id);
  const layer = doc.layers[index];
  if (!layer) return doc;
  // Step over layers in other groups so the move is visible where the layer lives.
  let target = index + direction;
  while (
    target >= 0 &&
    target < doc.layers.length &&
    doc.layers[target]!.folderId !== layer.folderId
  )
    target += direction;
  if (target < 0 || target >= doc.layers.length) return doc;
  const layers = [...doc.layers];
  layers[index] = layers[target]!;
  layers[target] = layer;
  return { ...doc, layers };
}

// ── Organising: drag and drop, bulk moves, names, colours ──

/**
 * Move a layer next to another (before it, in its folder) or to the end of a folder
 * (`folderId`, null for the top level). Used by drag and drop.
 */
export function placeLayer(
  doc: LayersDocument,
  id: string,
  target: { beforeId: string } | { folderId: string | null },
): LayersDocument {
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer) return doc;
  const rest = doc.layers.filter((l) => l.id !== id);
  if ("beforeId" in target) {
    const anchor = rest.find((l) => l.id === target.beforeId);
    if (!anchor) return doc;
    const index = rest.indexOf(anchor);
    return {
      ...doc,
      layers: [
        ...rest.slice(0, index),
        { ...layer, folderId: anchor.folderId },
        ...rest.slice(index),
      ],
    };
  }
  const folderId =
    target.folderId && doc.folders.some((f) => f.id === target.folderId) ? target.folderId : null;
  return {
    ...doc,
    layers: [...rest, { ...layer, folderId }],
    folders: doc.folders.map((f) => (f.id === folderId ? { ...f, collapsed: false } : f)),
  };
}

/** Move a folder before another one (drag and drop). */
export function placeFolder(doc: LayersDocument, id: string, beforeId: string): LayersDocument {
  const folder = doc.folders.find((f) => f.id === id);
  const rest = doc.folders.filter((f) => f.id !== id);
  const index = rest.findIndex((f) => f.id === beforeId);
  if (!folder || index < 0) return doc;
  return { ...doc, folders: [...rest.slice(0, index), folder, ...rest.slice(index)] };
}

export function assignDrawings(doc: LayersDocument, drawingIds: string[], layer: string) {
  if (!doc.layers.some((l) => l.id === layer)) return doc;
  const assignments = { ...doc.assignments };
  for (const id of drawingIds) assignments[id] = layer;
  return { ...doc, assignments };
}

/** Name a drawing in the panel; an empty name goes back to its type. */
export function renameDrawing(doc: LayersDocument, drawingId: string, name: string) {
  const clean = name
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, MAX_LAYER_NAME);
  const names = { ...doc.names };
  if (clean) names[drawingId] = clean;
  else delete names[drawingId];
  return { ...doc, names };
}

export const drawingName = (doc: LayersDocument, drawingId: string) =>
  doc.names?.[drawingId] ?? null;

export const setLayerColor = (
  doc: LayersDocument,
  id: string,
  color: string | null,
): LayersDocument => ({
  ...doc,
  layers: doc.layers.map((l) => {
    if (l.id !== id) return l;
    const { color: _old, ...rest } = l;
    return color && HEX.test(color) ? { ...rest, color } : rest;
  }),
});

/** Show only this layer (and its folder); every other layer is hidden. */
export function soloLayer(doc: LayersDocument, id: string): LayersDocument {
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer) return doc;
  return {
    ...doc,
    layers: doc.layers.map((l) => ({ ...l, visible: l.id === id })),
    folders: doc.folders.map((f) => (f.id === layer.folderId ? { ...f, visible: true } : f)),
  };
}

export const showEverything = (doc: LayersDocument): LayersDocument => ({
  ...doc,
  layers: doc.layers.map((l) => ({ ...l, visible: true })),
  folders: doc.folders.map((f) => ({ ...f, visible: true })),
});

export const unlockEverything = (doc: LayersDocument): LayersDocument => ({
  ...doc,
  layers: doc.layers.map((l) => ({ ...l, locked: false })),
  folders: doc.folders.map((f) => ({ ...f, locked: false })),
});

export const setAllFoldersCollapsed = (doc: LayersDocument, collapsed: boolean) => ({
  ...doc,
  folders: doc.folders.map((f) => ({ ...f, collapsed })),
});
