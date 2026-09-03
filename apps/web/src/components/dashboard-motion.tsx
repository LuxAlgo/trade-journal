"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { advanceCardSwing, cardSwingGeometry, STILL_CARD, type CardPoint } from "@/lib/card-swing";

export const DASHBOARD_MOVE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

export function useReducedDashboardMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => setReduced(query.matches);
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);
  return reduced;
}

interface CardLayoutSnapshot {
  bounds: DOMRect;
  width: number;
  height: number;
  opacity: number;
}

interface CardAnimation {
  animation: Animation;
  surface: HTMLElement;
  kind: "enter" | "exit" | "move";
  endsAt: number;
}

/** Keep departing cards alive outside the grid until their shrink animation finishes. */
export function useDashboardGridMotion(visible: string[]) {
  const orderKey = JSON.stringify(visible);
  const gridRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const before = useRef<{
    height: number;
    cards: Map<string, CardLayoutSnapshot>;
  } | null>(null);
  const animations = useRef(new Map<string, CardAnimation>());
  const stageAnimation = useRef<Animation | null>(null);
  const [presence, setPresence] = useState({ orderKey, visible, rendered: visible });

  let rendered = presence.rendered;
  if (presence.orderKey !== orderKey) {
    const wanted = new Set(visible);
    rendered = [...visible, ...presence.rendered.filter((id) => !wanted.has(id))];
    // Adjust before React commits so removed cards are never briefly unmounted.
    setPresence({ orderKey, visible, rendered });
  }
  const exiting = new Set(rendered.filter((id) => !visible.includes(id)));

  function captureLayout() {
    const stage = stageRef.current;
    const grid = gridRef.current;
    if (!stage || !grid) return;
    const cards = new Map<string, CardLayoutSnapshot>();
    grid.querySelectorAll<HTMLElement>("[data-dashboard-card]").forEach((card) => {
      const surface = card.querySelector<HTMLElement>("[data-dashboard-surface]");
      if (surface) {
        const bounds = card.getBoundingClientRect();
        cards.set(card.dataset.dashboardCard!, {
          bounds: surface.getBoundingClientRect(),
          width: bounds.width,
          height: bounds.height,
          opacity: Number(getComputedStyle(surface).opacity),
        });
      }
    });
    before.current = { height: stage.getBoundingClientRect().height, cards };
  }

  useLayoutEffect(() => {
    const grid = gridRef.current;
    const stage = stageRef.current;
    const captured = before.current;
    before.current = null;
    if (!grid || !stage) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>("[data-dashboard-card]"));
    const wanted = new Set<string>(JSON.parse(orderKey));
    const gridBounds = grid.getBoundingClientRect();
    const discard = new Set<string>();
    let enterIndex = 0;
    let exitIndex = 0;

    // Retiring cards keep their real React contents (including charts and privacy
    // updates), but no longer occupy a grid cell or accept focus/drag interactions.
    for (const card of cards) {
      const id = card.dataset.dashboardCard!;
      const previous = captured?.cards.get(id);
      if (!wanted.has(id) && previous) {
        Object.assign(card.style, {
          left: `${previous.bounds.left - gridBounds.left}px`,
          top: `${previous.bounds.top - gridBounds.top}px`,
          width: `${previous.width}px`,
          height: `${previous.height}px`,
        });
      } else {
        for (const property of ["left", "top", "width", "height"])
          card.style.removeProperty(property);
      }
    }

    // Measure every destination before starting animations. Outer cells stay
    // stable for drag collisions; their inner surfaces bridge the visual change.
    const moves = cards.map((card) => ({
      card,
      surface: card.querySelector<HTMLElement>("[data-dashboard-surface]"),
      previous: captured?.cards.get(card.dataset.dashboardCard!),
      next: card.getBoundingClientRect(),
    }));
    const nextHeight = grid.getBoundingClientRect().height;
    const visibilityChanged = moves.some(
      ({ card, previous }) => !wanted.has(card.dataset.dashboardCard!) || !previous,
    );

    for (const { card, surface, previous, next } of moves) {
      if (!surface) continue;
      const id = card.dataset.dashboardCard!;
      const retiring = !wanted.has(id);
      const running = animations.current.get(id);
      running?.animation.cancel();
      animations.current.delete(id);
      delete surface.dataset.dashboardMotion;

      if (reduced || !captured || (retiring && !previous)) {
        if (retiring) discard.add(id);
        continue;
      }
      if (card.dataset.dragging === "true" || !next.width || !next.height) continue;

      const kind = retiring ? "exit" : !previous || running?.kind === "exit" ? "enter" : "move";
      const x = previous ? previous.bounds.left - next.left : next.width * 0.4;
      const y = previous ? previous.bounds.top - next.top : next.height * 0.4;
      const sx = previous ? previous.bounds.width / next.width : 0.2;
      const sy = previous ? previous.bounds.height / next.height : 0.2;
      const opacity = previous?.opacity ?? 0;
      if (
        kind === "move" &&
        Math.abs(x) < 0.5 &&
        Math.abs(y) < 0.5 &&
        Math.abs(sx - 1) < 0.002 &&
        Math.abs(sy - 1) < 0.002 &&
        opacity > 0.998
      )
        continue;

      // Continue from the currently painted rectangle, even when the user
      // reverses a toggle halfway through an entrance or exit.
      const duration = retiring
        ? running?.kind === "exit"
          ? Math.max(60, running.endsAt - performance.now())
          : 250
        : visibilityChanged || kind === "enter"
          ? 440
          : 340;
      const delay = retiring
        ? running?.kind === "exit"
          ? 0
          : Math.min(exitIndex++ * 14, 70)
        : !previous
          ? Math.min(enterIndex++ * 24, 120)
          : 0;
      const endTransform = retiring
        ? `translate3d(${x + previous!.bounds.width * 0.48}px, ${y + previous!.bounds.height * 0.48}px, 0) scale(${sx * 0.04}, ${sy * 0.04})`
        : "translate3d(0, 0, 0) scale(1, 1)";
      const animation = surface.animate(
        [
          { transform: `translate3d(${x}px, ${y}px, 0) scale(${sx}, ${sy})`, opacity },
          { transform: endTransform, opacity: retiring ? 0 : 1 },
        ],
        {
          duration,
          delay,
          easing: retiring ? "cubic-bezier(0.4, 0, 0.2, 1)" : DASHBOARD_MOVE_EASING,
          fill: "both",
        },
      );
      surface.dataset.dashboardMotion = kind;
      animations.current.set(id, {
        animation,
        surface,
        kind,
        endsAt: performance.now() + duration + delay,
      });
      animation.onfinish = () => {
        if (animations.current.get(id)?.animation !== animation) return;
        if (retiring) {
          // Retain the final invisible frame until React removes the node.
          setPresence((current) =>
            current.visible.includes(id)
              ? current
              : { ...current, rendered: current.rendered.filter((cardId) => cardId !== id) },
          );
        } else {
          animation.cancel();
          animations.current.delete(id);
          delete surface.dataset.dashboardMotion;
        }
      };
    }

    stageAnimation.current?.cancel();
    stageAnimation.current = null;
    if (!reduced && captured && Math.abs(captured.height - nextHeight) > 0.5) {
      const animation = stage.animate(
        [{ height: `${captured.height}px` }, { height: `${nextHeight}px` }],
        { duration: visibilityChanged ? 440 : 340, easing: DASHBOARD_MOVE_EASING },
      );
      stageAnimation.current = animation;
      animation.onfinish = () => {
        if (stageAnimation.current === animation) stageAnimation.current = null;
      };
    }
    if (discard.size)
      setPresence((current) => ({
        ...current,
        rendered: current.rendered.filter((id) => !discard.has(id)),
      }));
  }, [orderKey]);

  // Release detached nodes/finished exit effects after React commits their removal.
  useLayoutEffect(() => {
    const retained = new Set(rendered);
    for (const [id, running] of animations.current) {
      if (!retained.has(id)) {
        running.animation.cancel();
        animations.current.delete(id);
      }
    }
  }, [rendered]);

  useEffect(() => {
    const running = animations.current;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    function settle() {
      running.forEach(({ animation, surface }) => {
        animation.cancel();
        delete surface.dataset.dashboardMotion;
      });
      running.clear();
      stageAnimation.current?.cancel();
      stageAnimation.current = null;
    }
    function onMotionChange() {
      if (!query.matches) return;
      settle();
      setPresence((current) => ({ ...current, rendered: current.visible }));
    }
    query.addEventListener("change", onMotionChange);
    return () => {
      query.removeEventListener("change", onMotionChange);
      settle();
    };
  }, []);

  // A new container width changes every destination. Retire stale effects so
  // the responsive grid and chart observers can follow the live dimensions.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    let width = grid.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      if (Math.abs(entry.contentRect.width - width) < 0.5) return;
      width = entry.contentRect.width;
      before.current = null;
      animations.current.forEach(({ animation, surface }) => {
        animation.cancel();
        delete surface.dataset.dashboardMotion;
      });
      animations.current.clear();
      stageAnimation.current?.cancel();
      stageAnimation.current = null;
      setPresence((current) =>
        current.rendered.length === current.visible.length
          ? current
          : { ...current, rendered: current.visible },
      );
    });
    observer.observe(grid);
    return () => observer.disconnect();
  });

  return { gridRef, stageRef, captureLayout, rendered, exiting };
}

export interface DashboardCardSnapshot {
  element: HTMLElement;
  width: number;
  height: number;
  grab: CardPoint;
  pointer: (CardPoint & { id: number | null }) | null;
}

/** Copy the visible card, including canvas charts and the currently selected tab. */
export function snapshotDashboardCard(surface: HTMLElement, event: Event): DashboardCardSnapshot {
  const bounds = surface.getBoundingClientRect();
  const handle = surface.querySelector("button[aria-label^='Rearrange']")?.getBoundingClientRect();
  const pointer =
    event instanceof MouseEvent
      ? {
          x: event.clientX,
          y: event.clientY,
          id: event instanceof PointerEvent ? event.pointerId : null,
        }
      : null;
  const grab = {
    x: Math.max(
      0,
      Math.min(
        bounds.width,
        (pointer?.x ?? (handle ? handle.left + handle.width / 2 : bounds.left + bounds.width / 2)) -
          bounds.left,
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        bounds.height,
        (pointer?.y ?? (handle ? handle.top + handle.height / 2 : bounds.top + 24)) - bounds.top,
      ),
    ),
  };
  const copy = surface.cloneNode(true) as HTMLElement;
  copy.removeAttribute("data-dashboard-surface");
  copy.style.transform = "none";
  copy.style.height = "100%";
  const canvases = copy.querySelectorAll("canvas");
  surface.querySelectorAll("canvas").forEach((canvas, index) => {
    const target = canvases[index];
    if (target) target.getContext("2d")?.drawImage(canvas, 0, 0);
  });

  // SVG gradients and clip paths must refer to this snapshot, not to a live chart
  // whose dimensions may change as the surrounding grid reflows.
  const prefix = `drag-${crypto.randomUUID()}`;
  const ids = new Map<string, string>();
  copy.querySelectorAll<HTMLElement>("[id]").forEach((node) => {
    const original = node.id;
    node.id = `${prefix}-${original}`;
    ids.set(original, node.id);
  });
  copy.querySelectorAll("*").forEach((node) => {
    for (const attribute of Array.from(node.attributes)) {
      let value = attribute.value;
      for (const [original, replacement] of ids) {
        value = value.replaceAll(`url(#${original})`, `url(#${replacement})`);
        if (value === `#${original}`) value = `#${replacement}`;
      }
      if (value !== attribute.value) node.setAttribute(attribute.name, value);
    }
  });
  return { element: copy, width: bounds.width, height: bounds.height, grab, pointer };
}

/** Read raw pointer travel so grid reflow and automatic scrolling cannot add a swing. */
export function useDashboardDragInput() {
  const point = useRef<CardPoint>({ x: 0, y: 0 });
  const stopPointer = useRef<(() => void) | null>(null);
  const pointerActive = useRef(false);
  function stop() {
    stopPointer.current?.();
    stopPointer.current = null;
    pointerActive.current = false;
  }
  function start(snapshot: DashboardCardSnapshot | null) {
    stop();
    point.current = { x: 0, y: 0 };
    const origin = snapshot?.pointer;
    if (!origin) return;
    pointerActive.current = true;
    const move = (event: PointerEvent) => {
      if (origin.id !== null && event.pointerId !== origin.id) return;
      point.current = { x: event.clientX - origin.x, y: event.clientY - origin.y };
    };
    window.addEventListener("pointermove", move, { passive: true });
    stopPointer.current = () => window.removeEventListener("pointermove", move);
  }
  function moveKeyboard(delta: CardPoint) {
    if (!pointerActive.current) point.current = delta;
  }
  useEffect(() => () => stopPointer.current?.(), []);
  return { point, start, stop, moveKeyboard };
}

export function DashboardDragPreview({
  snapshot,
  movement,
  reducedMotion,
}: {
  snapshot: DashboardCardSnapshot;
  movement: RefObject<CardPoint>;
  reducedMotion: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = host.current;
    element?.replaceChildren(snapshot.element);
    return () => element?.replaceChildren();
  }, [snapshot]);

  useLayoutEffect(() => {
    const element = host.current;
    if (!element || reducedMotion) {
      element?.style.removeProperty("--dashboard-swing");
      return;
    }
    const geometry = cardSwingGeometry(snapshot.width, snapshot.height, snapshot.grab);
    let state = { ...STILL_CARD };
    let lastPoint = { x: 0, y: 0 };
    let lastTime = performance.now();
    let lastAngle = "";
    let frame = 0;
    function animate(now: number) {
      const point = movement.current;
      state = advanceCardSwing(
        state,
        { x: point.x - lastPoint.x, y: point.y - lastPoint.y },
        (now - lastTime) / 1000,
        geometry,
      );
      lastPoint = point;
      lastTime = now;
      const angle = `${state.angle.toFixed(3)}deg`;
      if (angle !== lastAngle) element!.style.setProperty("--dashboard-swing", angle);
      lastAngle = angle;
      frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [snapshot, movement, reducedMotion]);

  return (
    <div
      className="dashboard-drag-preview"
      aria-hidden="true"
      inert
      style={
        {
          width: snapshot.width,
          height: snapshot.height,
          "--dashboard-grab-x": `${snapshot.grab.x}px`,
          "--dashboard-grab-y": `${snapshot.grab.y}px`,
        } as CSSProperties
      }
    >
      <div className="dashboard-drag-lift">
        <div ref={host} className="dashboard-drag-swing" />
      </div>
    </div>
  );
}
