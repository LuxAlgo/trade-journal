export interface CardPoint {
  x: number;
  y: number;
}

export interface CardSwing {
  angle: number;
  angularVelocity: number;
  velocityX: number;
  velocityY: number;
}

export const STILL_CARD: CardSwing = {
  angle: 0,
  angularVelocity: 0,
  velocityX: 0,
  velocityY: 0,
};

export function cardSwingGeometry(width: number, height: number, grab: CardPoint) {
  const x = width / 2 - grab.x;
  const y = height / 2 - grab.y;
  const lever = Math.max(1, Math.hypot(x, y));
  const reach = Math.hypot(Math.max(grab.x, width - grab.x), Math.max(grab.y, height - grab.y));
  return {
    leverX: x / lever,
    leverY: y / lever,
    // Large charts move through a smaller angle to keep their far edge controlled.
    maxAngle: Math.min(8, (Math.atan2(34, reach) * 180) / Math.PI),
  };
}

/** A damped angular spring driven by cursor velocity around the actual grab point. */
export function advanceCardSwing(
  previous: CardSwing,
  movement: CardPoint,
  elapsed: number,
  geometry: ReturnType<typeof cardSwingGeometry>,
): CardSwing {
  if (!Number.isFinite(elapsed) || elapsed <= 0) return previous;
  // A suspended tab must not accumulate a large impulse on its first resumed frame.
  if (elapsed > 0.2) return { ...STILL_CARD };
  const speed = Math.hypot(movement.x, movement.y) / elapsed;
  const limit = speed > 2400 ? 2400 / speed : 1;
  const inputX = (movement.x / elapsed) * limit;
  const inputY = (movement.y / elapsed) * limit;
  const state = { ...previous };
  const steps = Math.ceil(elapsed * 120);
  const dt = elapsed / steps;
  const smoothing = 1 - Math.exp(-dt / 0.035);

  for (let step = 0; step < steps; step++) {
    state.velocityX += (inputX - state.velocityX) * smoothing;
    state.velocityY += (inputY - state.velocityY) * smoothing;
    const torque = state.velocityX * geometry.leverY - state.velocityY * geometry.leverX;
    const target = Math.max(-geometry.maxAngle, Math.min(geometry.maxAngle, torque * 0.018));
    state.angularVelocity += ((target - state.angle) * 190 - state.angularVelocity * 16) * dt;
    state.angle += state.angularVelocity * dt;
    const bound = geometry.maxAngle * 1.2;
    if (Math.abs(state.angle) > bound) {
      state.angle = Math.sign(state.angle) * bound;
      if (state.angle * state.angularVelocity > 0) state.angularVelocity = 0;
    }
  }

  if (
    Math.abs(state.angle) < 0.005 &&
    Math.abs(state.angularVelocity) < 0.015 &&
    Math.hypot(state.velocityX, state.velocityY) < 0.1
  )
    return { ...STILL_CARD };
  return state;
}
