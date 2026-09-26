/**
 * Drawing layers for chart analyses: folders hold layers, layers hold drawings, and a drawing
 * can hold other drawings (the sub-waves of a wave), to any depth. Layers own visibility and
 * locking; a drawing hidden or locked by its layer is enforced on the chart. Everything here
 * is pure so the chart, the panel and the server agree on one model.
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
  /**
   * Vela drawing id → the drawing it sits inside (a sub-wave → its wave). A drawing and
   * everything inside it share one layer.
   */
  parents?: Record<string, string>;
  /** New drawings go inside this drawing (instead of at the top of the active layer). */
  drawInto?: string;
  /** Only this drawing and what is inside it show on the chart. */
  focusId?: string;
  /** Drawings outside the focus that were already hidden, kept hidden when focus ends. */
  focusHidden?: string[];
}

export const MAX_FOLDERS = 50;
export const MAX_LAYERS = 200;
export const MAX_LAYER_NAME = 80;
const MAX_DRAWING_REFS = 5000;
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
  const nesting = nestingProblem(doc);
  if (nesting) return nesting;
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

const isRef = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= 100;

function nestingProblem(doc: Partial<LayersDocument>): string | null {
  if (doc.parents !== undefined) {
    if (!doc.parents || typeof doc.parents !== "object" || Array.isArray(doc.parents))
      return "Drawing nesting is invalid.";
    const entries = Object.entries(doc.parents);
    if (entries.length > MAX_DRAWING_REFS) return "Too many nested drawings.";
    for (const [child, parent] of entries)
      if (!isRef(child) || !isRef(parent) || child === parent)
        return "A nested drawing is invalid.";
    // Walking up from any drawing must end: a drawing can never sit inside itself.
    for (const [child] of entries) {
      const seen = new Set([child]);
      for (let at = doc.parents[child]; at; at = doc.parents[at]) {
        if (seen.has(at)) return "Drawing nesting has a loop.";
        seen.add(at);
      }
    }
  }
  for (const key of ["drawInto", "focusId"] as const)
    if (doc[key] !== undefined && !isRef(doc[key])) return "A drawing reference is invalid.";
  if (
    doc.focusHidden !== undefined &&
    !(
      Array.isArray(doc.focusHidden) &&
      doc.focusHidden.length <= MAX_DRAWING_REFS &&
      doc.focusHidden.every(isRef)
    )
  )
    return "Focus settings are invalid.";
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
  const next = changed ? { ...doc, assignments, ...(names ? { names } : {}) } : doc;
  return syncNesting(next, present);
}

/**
 * Nesting after drawings come and go: a deleted drawing's contents move up to the nearest
 * drawing still there (or the top of the layer), and a link across layers is dropped.
 */
function syncNesting(doc: LayersDocument, present: Set<string>): LayersDocument {
  let next = doc;
  const parents = doc.parents;
  if (parents) {
    const kept: Record<string, string> = {};
    let changed = false;
    for (const [child, parent] of Object.entries(parents)) {
      if (!present.has(child)) {
        changed = true;
        continue;
      }
      let at: string | undefined = parent;
      const seen = new Set([child]);
      while (at && !present.has(at) && !seen.has(at)) {
        seen.add(at);
        at = parents[at];
      }
      const valid = at && present.has(at) && doc.assignments[at] === doc.assignments[child];
      if (valid) kept[child] = at!;
      if (!valid || at !== parent) changed = true;
    }
    if (changed) next = withParents(next, kept);
  }
  for (const key of ["drawInto", "focusId"] as const)
    if (next[key] && !present.has(next[key])) next = without(next, key);
  if (!next.focusId && next.focusHidden) next = without(next, "focusHidden");
  return next;
}

const without = (doc: LayersDocument, key: "drawInto" | "focusId" | "focusHidden") => {
  const { [key]: _gone, ...rest } = doc;
  return rest as LayersDocument;
};

const withParents = (doc: LayersDocument, parents: Record<string, string>): LayersDocument => {
  if (Object.keys(parents).length) return { ...doc, parents };
  const { parents: _gone, ...rest } = doc;
  return rest;
};

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

/** What a drawing is forced to: its layer's state, and hidden when outside the focus. */
export function effectiveDrawing(doc: LayersDocument, drawingId: string) {
  const layer = effectiveLayer(doc, layerOf(doc, drawingId));
  return { visible: layer.visible && inFocus(doc, drawingId), locked: layer.locked };
}

/** Whether a drawing shows under the current focus (always, with no focus). */
export const inFocus = (doc: LayersDocument, drawingId: string) =>
  !doc.focusId || drawingId === doc.focusId || ancestorsOf(doc, drawingId).includes(doc.focusId);

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
  // Leaving or changing a focus brings back what it hid, except drawings you hid yourself.
  const keepHidden = new Set(previous?.focusId ? (previous.focusHidden ?? []) : []);
  for (const drawing of drawings) {
    const now = effectiveDrawing(doc, drawing.id);
    const before = previous ? effectiveDrawing(previous, drawing.id) : now;
    const visible = !now.visible
      ? false
      : !before.visible
        ? !keepHidden.has(drawing.id)
        : drawing.visible;
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

/**
 * Move drawings to a layer, each with everything inside it. A moved drawing lands at the top
 * of that layer unless the drawing it sits inside moves with it.
 */
export function assignDrawings(doc: LayersDocument, drawingIds: string[], layer: string) {
  if (!doc.layers.some((l) => l.id === layer)) return doc;
  const moving = new Set(drawingIds.flatMap((id) => [id, ...descendantsOf(doc, id)]));
  const assignments = { ...doc.assignments };
  for (const id of moving) assignments[id] = layer;
  const parents = { ...doc.parents };
  for (const id of drawingIds) if (parents[id] && !moving.has(parents[id])) delete parents[id];
  return withParents({ ...doc, assignments }, parents);
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

/** Every layer and folder shown, and any focus ended. */
export const showEverything = (doc: LayersDocument): LayersDocument => ({
  ...without(without(doc, "focusId"), "focusHidden"),
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

// ── Drawings inside drawings: sub-waves inside a wave ──

export const parentOf = (doc: LayersDocument, drawingId: string) =>
  doc.parents?.[drawingId] ?? null;

/** The drawings a drawing sits inside, nearest first. */
export function ancestorsOf(doc: LayersDocument, drawingId: string): string[] {
  const out: string[] = [];
  const seen = new Set([drawingId]);
  for (let at = doc.parents?.[drawingId]; at && !seen.has(at); at = doc.parents?.[at]) {
    out.push(at);
    seen.add(at);
  }
  return out;
}

/** Everything inside a drawing, at any depth, in nesting order. */
export function descendantsOf(doc: LayersDocument, drawingId: string): string[] {
  const children = new Map<string, string[]>();
  for (const [child, parent] of Object.entries(doc.parents ?? {}))
    children.set(parent, [...(children.get(parent) ?? []), child]);
  const out: string[] = [];
  const seen = new Set([drawingId]);
  const walk = (id: string) => {
    for (const child of children.get(id) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      walk(child);
    }
  };
  walk(drawingId);
  return out;
}

/**
 * Put drawings inside another one, with what is inside them; they join its layer. A drawing
 * can't go inside itself or inside something it contains, so those are left where they are.
 */
export function nestDrawings(
  doc: LayersDocument,
  drawingIds: string[],
  parentId: string,
): LayersDocument {
  const blocked = new Set([parentId, ...ancestorsOf(doc, parentId)]);
  const moving = drawingIds.filter((id) => !blocked.has(id));
  if (!moving.length) return doc;
  const layer = layerOf(doc, parentId).id;
  const assignments = { ...doc.assignments };
  const parents = { ...doc.parents };
  for (const id of moving) {
    parents[id] = parentId;
    for (const inside of [id, ...descendantsOf(doc, id)]) assignments[inside] = layer;
  }
  return { ...doc, assignments, parents };
}

/** Take drawings one level out: into the drawing that held their parent, or the layer's top. */
export function unnestDrawings(doc: LayersDocument, drawingIds: string[]): LayersDocument {
  const parents = { ...doc.parents };
  let changed = false;
  for (const id of drawingIds) {
    const parent = parents[id];
    if (!parent) continue;
    changed = true;
    const up = parents[parent];
    if (up) parents[id] = up;
    else delete parents[id];
  }
  return changed ? withParents(doc, parents) : doc;
}

/** Keep copies nested like their sources (a copied wave keeps its copied sub-waves). */
export function copyNesting(
  doc: LayersDocument,
  sources: string[],
  copies: string[],
): LayersDocument {
  const copyOf = new Map(sources.map((source, i) => [source, copies[i]]));
  const parents = { ...doc.parents };
  sources.forEach((source, i) => {
    const copy = copies[i];
    const parent = doc.parents?.[source];
    if (!copy || !parent) return;
    const target = copyOf.get(parent) ?? parent;
    if (doc.assignments[target] === doc.assignments[copy]) parents[copy] = target;
  });
  return withParents(doc, parents);
}

/** New drawings go inside this drawing, or back to the active layer's top with null. */
export const setDrawInto = (doc: LayersDocument, drawingId: string | null): LayersDocument =>
  drawingId ? { ...doc, drawInto: drawingId } : without(doc, "drawInto");

/**
 * Show only a drawing and what is inside it, or everything again with null. `drawings` are
 * the chart's, to remember which ones outside the focus you had hidden yourself.
 */
export function setFocus(
  doc: LayersDocument,
  drawingId: string | null,
  drawings: { id: string; visible: boolean }[],
): LayersDocument {
  if (!drawingId) return without(without(doc, "focusId"), "focusHidden");
  const inside = new Set([drawingId, ...descendantsOf(doc, drawingId)]);
  // Hidden by an earlier focus counts as shown: that focus is what hid it.
  const earlier = doc.focusId ? new Set(doc.focusHidden ?? []) : null;
  const hidden = drawings
    .filter((d) => !inside.has(d.id))
    .filter((d) => (earlier && !inFocus(doc, d.id) ? earlier.has(d.id) : !d.visible))
    .map((d) => d.id);
  return { ...doc, focusId: drawingId, focusHidden: hidden };
}

/** Where a new drawing goes: inside the draw-into drawing or the focus, else the active layer. */
export function placeNewDrawing(doc: LayersDocument, drawingId: string): LayersDocument {
  const known = (id: string | undefined) => (id && doc.assignments[id] ? id : undefined);
  let target = known(doc.drawInto);
  const focus = known(doc.focusId);
  // While focused, new drawings stay inside the focus, or they would vanish as they are made.
  if (focus && (!target || !(target === focus || ancestorsOf(doc, target).includes(focus))))
    target = focus;
  if (!target) {
    const active = doc.layers.find((l) => l.id === doc.activeLayerId)!;
    const effective = effectiveLayer(doc, active);
    // Never file a new drawing where it would vanish or freeze.
    const ready = effective.visible && !effective.locked ? doc : setActiveLayer(doc, active.id);
    return assignDrawing(ready, drawingId, ready.activeLayerId);
  }
  const layer = layerOf(doc, target);
  const effective = effectiveLayer(doc, layer);
  const ready = effective.visible && !effective.locked ? doc : revealLayer(doc, layer.id);
  return {
    ...ready,
    assignments: { ...ready.assignments, [drawingId]: layer.id },
    parents: { ...ready.parents, [drawingId]: target },
  };
}

/** Show and unlock a layer and its folder, leaving the active layer as it is. */
function revealLayer(doc: LayersDocument, id: string): LayersDocument {
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer) return doc;
  return {
    ...doc,
    layers: doc.layers.map((l) => (l.id === id ? { ...l, visible: true, locked: false } : l)),
    folders: doc.folders.map((f) =>
      f.id === layer.folderId ? { ...f, visible: true, locked: false } : f,
    ),
  };
}

/** A drawing in the panel's tree: its outline number (1, 1.2, 1.2.3) and what is inside it. */
export interface DrawingNode {
  id: string;
  index: string;
  depth: number;
  children: DrawingNode[];
}

/** A layer's drawings as a tree, siblings in chart order. */
export function drawingTree(
  doc: LayersDocument,
  layerId: string,
  drawingIds: string[],
): DrawingNode[] {
  const inLayer = drawingsIn(doc, layerId, drawingIds);
  const here = new Set(inLayer);
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const id of inLayer) {
    const parent = doc.parents?.[id];
    if (parent && here.has(parent) && !ancestorsOf(doc, parent).includes(id))
      children.set(parent, [...(children.get(parent) ?? []), id]);
    else roots.push(id);
  }
  const seen = new Set<string>();
  const build = (ids: string[], prefix: string, depth: number): DrawingNode[] =>
    ids
      .filter((id) => !seen.has(id) && (seen.add(id), true))
      .map((id, i) => {
        const index = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
        return { id, index, depth, children: build(children.get(id) ?? [], index, depth + 1) };
      });
  return build(roots, "", 0);
}
