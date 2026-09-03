import { describe, expect, it } from "vitest";
import {
  advanceCardSwing,
  cardSwingGeometry,
  STILL_CARD,
  type CardSwing,
} from "../src/lib/card-swing";

const geometry = cardSwingGeometry(200, 150, { x: 16, y: 24 });
function travel(state: CardSwing, vx: number, vy: number, seconds: number, hz = 120) {
  for (let frame = 0; frame < Math.round(seconds * hz); frame++)
    state = advanceCardSwing(state, { x: vx / hz, y: vy / hz }, 1 / hz, geometry);
  return state;
}

describe("card swing connected to cursor movement", () => {
  it("stays completely still when picked up without cursor movement", () => {
    expect(travel(STILL_CARD, 0, 0, 3)).toEqual(STILL_CARD);
  });

  it("trails the direction of travel, with a stronger lean for faster movement", () => {
    const slow = travel(STILL_CARD, 90, 0, 0.5);
    const right = travel(STILL_CARD, 500, 0, 0.5);
    const left = travel(STILL_CARD, -500, 0, 0.5);
    expect(slow.angle).toBeGreaterThan(0);
    expect(right.angle).toBeGreaterThan(slow.angle * 3);
    expect(left.angle).toBeCloseTo(-right.angle, 5);
  });

  it("carries momentum through a direction change and settles after stopping", () => {
    const moving = travel(STILL_CARD, 600, 0, 0.5);
    const reversing = travel(moving, -600, 0, 1 / 120);
    expect(reversing.angle).toBeGreaterThan(0);
    expect(Math.abs(reversing.angle - moving.angle)).toBeLessThan(0.2);
    expect(travel(reversing, -600, 0, 0.3).angle).toBeLessThan(0);
    const stopped = travel(moving, 0, 0, 1 / 120);
    expect(stopped.angle).toBeGreaterThan(0);
    expect(travel(stopped, 0, 0, 2)).toEqual(STILL_CARD);
  });

  it("changes the swing according to which point holds the card", () => {
    const left = cardSwingGeometry(200, 150, { x: 16, y: 24 });
    const right = cardSwingGeometry(200, 150, { x: 184, y: 24 });
    const middle = cardSwingGeometry(200, 150, { x: 100, y: 75 });
    const movement = { x: 0, y: 10 };
    const fromLeft = advanceCardSwing(STILL_CARD, movement, 1 / 60, left);
    const fromRight = advanceCardSwing(STILL_CARD, movement, 1 / 60, right);
    expect(fromLeft.angle).toBeLessThan(0);
    expect(fromRight.angle).toBeCloseTo(-fromLeft.angle, 5);
    expect(advanceCardSwing(STILL_CARD, movement, 1 / 60, middle).angle).toBe(0);
  });

  it("remains consistent across frame rates", () => {
    const slowFrames = travel(STILL_CARD, 450, 100, 0.5, 30);
    const fastFrames = travel(STILL_CARD, 450, 100, 0.5, 120);
    expect(Math.abs(slowFrames.angle - fastFrames.angle)).toBeLessThan(0.05);
    expect(
      Math.abs(travel(slowFrames, 0, 0, 0.5, 30).angle - travel(fastFrames, 0, 0, 0.5, 120).angle),
    ).toBeLessThan(0.05);
  });

  it("limits large-card rotation and discards stale motion after a suspended frame", () => {
    const large = cardSwingGeometry(1040, 360, { x: 16, y: 24 });
    expect(large.maxAngle).toBeLessThan(geometry.maxAngle);
    let state = STILL_CARD;
    for (let frame = 0; frame < 240; frame++) {
      state = advanceCardSwing(state, { x: frame < 120 ? 10000 : -10000, y: 10000 }, 1 / 60, large);
      expect(Math.abs(state.angle)).toBeLessThanOrEqual(large.maxAngle * 1.2);
      expect(Number.isFinite(state.angularVelocity)).toBe(true);
    }
    expect(advanceCardSwing(state, { x: 10000, y: 10000 }, 5, large)).toEqual(STILL_CARD);
  });
});
