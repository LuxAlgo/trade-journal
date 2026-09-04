export interface DashboardDragPoint {
  x: number;
  y: number;
}

export interface DashboardDropRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Ignore the unstable outer rim of a card while pointer-dragging. Grid reflow
 * can swap the card beneath a pointer sitting exactly on an edge; requiring a
 * small amount of penetration makes the intended destination unambiguous.
 */
export function isInsideDashboardReorderZone(
  point: DashboardDragPoint,
  rect: DashboardDropRect,
  inset = 18,
) {
  const xInset = Math.min(inset, Math.max(0, (rect.width - 1) / 2));
  const yInset = Math.min(inset, Math.max(0, (rect.height - 1) / 2));
  return (
    point.x >= rect.left + xInset &&
    point.x <= rect.right - xInset &&
    point.y >= rect.top + yInset &&
    point.y <= rect.bottom - yInset
  );
}
