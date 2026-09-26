import type { DrawingTypeKey, Vela } from "@luxalgo/vela";
import { isBrush, type StylusPreference } from "@/lib/stylus";

/** The stylus eraser end reports button 5 on press and bit 32 in `buttons` while held. */
const isEraserTip = (event: PointerEvent) =>
  event.pointerType === "pen" && (event.button === 5 || (event.buttons & 32) !== 0);

/**
 * Stylus routing for a Vela chart, in the capture phase before Vela's own handlers:
 * the pen tip draws (arming the brush when no tool is chosen), a pen tap selects, the
 * eraser end erases, and touches while a pen is down are ignored as palm contact. Fingers
 * and the mouse keep panning. Returns the cleanup.
 */
export function attachStylus(
  instance: Vela,
  element: HTMLElement,
  options: {
    prefs: () => StylusPreference;
    armedByPen: { current: boolean };
    onPen: () => void;
  },
): () => void {
  const pens = new Set<number>();
  const palms = new Set<number>();
  let press: { id: number; x: number; y: number; created: boolean; armed: boolean } | null = null;
  let eraserRestore: { tool: DrawingTypeKey | null; armedByPen: boolean } | null = null;
  let replaying = false;
  const offCreated = instance.on("drawing:created", () => press && (press.created = true));
  const replay = (target: EventTarget, init: PointerEventInit, types: string[]) => {
    replaying = true;
    try {
      for (const type of types)
        target.dispatchEvent(
          new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, ...init }),
        );
    } finally {
      replaying = false;
    }
  };
  const pointerInit = (event: PointerEvent): PointerEventInit => ({
    pointerId: event.pointerId,
    pointerType: "pen",
    isPrimary: event.isPrimary,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    pressure: event.pressure,
  });
  const onDown = (event: PointerEvent) => {
    if (replaying) return;
    const target = event.target;
    if (!(target instanceof HTMLCanvasElement)) return;
    const drawingsApi = instance.drawings;
    if (event.pointerType === "pen") {
      pens.add(event.pointerId);
      options.onPen();
      if (isEraserTip(event)) {
        // Vela only reacts to the primary button: replay the eraser tip as a
        // primary press in eraser mode, then restore the tool on release.
        event.stopImmediatePropagation();
        event.preventDefault();
        eraserRestore = { tool: drawingsApi.getTool(), armedByPen: options.armedByPen.current };
        drawingsApi.setMode("eraser");
        replay(target, { ...pointerInit(event), button: 0, buttons: 1 }, ["pointerdown"]);
        return;
      }
      let armed = false;
      if (options.prefs().penDraws && !drawingsApi.getTool() && !drawingsApi.getMode()) {
        drawingsApi.setTool(options.prefs().penTool);
        options.armedByPen.current = true;
        armed = true;
      }
      press = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        created: false,
        armed,
      };
      return;
    }
    if (event.pointerType === "touch" && pens.size) {
      // Palm resting on the screen while the pen writes: hide the whole contact from Vela,
      // or its moves would drag the stroke in progress.
      palms.add(event.pointerId);
      event.stopImmediatePropagation();
      event.preventDefault();
      return;
    }
    if (options.armedByPen.current && isBrush(drawingsApi.getTool())) {
      // A finger or mouse after the pen pans the chart instead of drawing.
      drawingsApi.setTool(null);
      options.armedByPen.current = false;
    }
  };
  const onPalm = (event: PointerEvent) => {
    if (!palms.has(event.pointerId)) return;
    if (event.type !== "pointermove") palms.delete(event.pointerId);
    event.stopImmediatePropagation();
    event.preventDefault();
  };
  // On window, bubble phase: Vela has handled the release, and a release outside the
  // chart still clears the pen (a stuck pen would reject every later touch).
  const onUp = (event: PointerEvent) => {
    if (replaying || event.pointerType !== "pen") return;
    pens.delete(event.pointerId);
    if (eraserRestore) {
      const restore = eraserRestore;
      eraserRestore = null;
      instance.drawings.setMode(null);
      if (restore.tool) instance.drawings.setTool(restore.tool);
      options.armedByPen.current = restore.armedByPen;
      return;
    }
    const tap = press;
    press = null;
    if (
      !tap ||
      tap.id !== event.pointerId ||
      event.type !== "pointerup" ||
      !tap.armed ||
      tap.created ||
      Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 6
    )
      return;
    // A pen tap that drew nothing selects what is under it, like a mouse click: put the
    // auto-armed pen down and replay the tap to Vela's selection.
    const target = document.elementFromPoint(tap.x, tap.y);
    if (!(target instanceof HTMLCanvasElement) || !element.contains(target)) return;
    instance.drawings.setTool(null);
    options.armedByPen.current = false;
    replay(target, { ...pointerInit(event), clientX: tap.x, clientY: tap.y, button: 0 }, [
      "pointerdown",
      "pointerup",
    ]);
  };
  element.addEventListener("pointerdown", onDown, { capture: true });
  for (const type of ["pointermove", "pointerup", "pointercancel"] as const)
    element.addEventListener(type, onPalm, { capture: true });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  return () => {
    offCreated();
    element.removeEventListener("pointerdown", onDown, { capture: true });
    for (const type of ["pointermove", "pointerup", "pointercancel"] as const)
      element.removeEventListener(type, onPalm, { capture: true });
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };
}
