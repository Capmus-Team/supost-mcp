import { afterEach, describe, expect, it } from "vitest";
import { GET } from "../api/health.js";
import { serverVersion } from "../src/version.js";

afterEach(() => {
  delete process.env.BRAND;
  delete process.env.VERCEL_GIT_COMMIT_SHA;
});

describe("GET /api/health", () => {
  it("answers ok with the brand and version as JSON", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      brand: "supost",
      version: serverVersion(),
    });
  });

  it("reports the capmus brand and the deployed commit", async () => {
    process.env.BRAND = "capmus";
    process.env.VERCEL_GIT_COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
    const body = (await GET().json()) as { brand: string; version: string };
    expect(body.brand).toBe("capmus");
    expect(body.version).toMatch(/^\d+\.\d+\.\d+\+0123456$/);
  });
});
