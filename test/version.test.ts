import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { serverVersion } from "../src/version.js";

const pkgVersion = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

describe("serverVersion", () => {
  it("is the package.json version outside Vercel", () => {
    expect(pkgVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(serverVersion({})).toBe(pkgVersion);
  });

  it("suffixes the deployed commit's short sha on Vercel", () => {
    expect(
      serverVersion({ VERCEL_GIT_COMMIT_SHA: "835efb3c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60" })
    ).toBe(`${pkgVersion}+835efb3`);
  });

  it("ignores an empty sha", () => {
    expect(serverVersion({ VERCEL_GIT_COMMIT_SHA: "  " })).toBe(pkgVersion);
  });
});
