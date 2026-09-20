import { expect, it } from "vitest";
import { parseTimestamp } from "../src/dates";

it.each([
  ["2026-01-05, 09:30:00", "2026-01-05T09:30:00.000Z"],
  ["2026-01-05, 10:00:00", "2026-01-05T10:00:00.000Z"],
  ["2026-01-05T09:30:00.123", "2026-01-05T09:30:00.123Z"],
  ["1/5/2026 9:30:00.12 AM", "2026-01-05T09:30:00.120Z"],
  ["Jan 5, 2026 9:30:00.1 PM", "2026-01-05T21:30:00.100Z"],
  ["20260105;093000", "2026-01-05T09:30:00.000Z"],
  ["2026.01.05", "2026-01-05T00:00:00.000Z"],
  ["2024-02-29 23:59:59.999", "2024-02-29T23:59:59.999Z"],
])("preserves full timestamp %s", (input, expected) => {
  expect(parseTimestamp(input)).toBe(expected);
});
it("preserves fractional seconds while applying a statement timezone", () => {
  expect(parseTimestamp("2026-01-05 09:30:00.123", "America/New_York")).toBe(
    "2026-01-05T14:30:00.123Z",
  );
  expect(parseTimestamp("2026-07-05 09:30:00.123", "America/New_York")).toBe(
    "2026-07-05T13:30:00.123Z",
  );
  expect(parseTimestamp("2026-01-05T09:30:00.123+02:00", "America/New_York")).toBe(
    "2026-01-05T07:30:00.123Z",
  );
});
it.each([
  "2026-01-05 garbage",
  "2026-01-05, 29:30:00",
  "2026-02-30",
  "2026-01-05 09:60:00",
  "2026-01-05 09:30:60",
  "2026-13-05",
  "1/5/2026 13:30 PM",
  "2026-01-05 09:30:00.1234",
])("rejects invalid or unsupported precision rather than changing timestamp %s", (input) => {
  expect(parseTimestamp(input)).toBeNull();
});
