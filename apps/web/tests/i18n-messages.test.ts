import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkMessages } from "../../../scripts/check-messages.mjs";

const messagesDir = fileURLToPath(new URL("../messages", import.meta.url));

/**
 * Gate wrapper (T07): asserts the real message resources are complete.
 * This test turns red whenever a worker adds a key without translating it
 * into all seven locales, or breaks ICU syntax — that is the point.
 */
describe("message resource integrity gate", () => {
  it("reports no problems for the real seven-locale resources", () => {
    expect(checkMessages(messagesDir)).toEqual([]);
  });
});
