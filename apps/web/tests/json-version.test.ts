import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import { GET } from "../src/app/json/version/route";

describe("version probe", () => {
  it("answers GET /json/version with the app name and version", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      name: packageJson.name,
      version: packageJson.version,
    });
  });
});
