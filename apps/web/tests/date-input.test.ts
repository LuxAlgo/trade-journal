import { describe, expect, it } from "vitest";
import { formatDateInput, parseDateInput } from "../src/lib/date-input";

describe("date-only picker values", () => {
  it("round trips dates without converting through UTC", () => {
    for (const value of ["2026-09-04", "2024-02-29", "2026-12-31", "0099-01-01"]) {
      expect(formatDateInput(parseDateInput(value)!)).toBe(value);
    }
  });
  it("rejects impossible and partial dates", () => {
    for (const value of [
      "",
      "2026-02-29",
      "2026-04-31",
      "2026-13-01",
      "2026-00-01",
      "2026-09-00",
      "2026-9-1",
      "09/04/2026",
    ]) {
      expect(parseDateInput(value)).toBeUndefined();
    }
  });
});
