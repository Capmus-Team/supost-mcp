/**
 * The version an MCP `initialize` response and GET /health report. On
 * Vercel it is `<package version>+<7-char git sha>` (VERCEL_GIT_COMMIT_SHA
 * is set on every deployment, git or CLI), so the deployed commit is visible
 * from the outside — production ran a stale CLI deploy for three weeks in
 * 2026-09 because nothing exposed it. Locally it is the package version.
 */

import { readFileSync } from "node:fs";

function packageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

export function serverVersion(env: NodeJS.ProcessEnv = process.env): string {
  const sha = env.VERCEL_GIT_COMMIT_SHA?.trim();
  const base = packageVersion();
  return sha ? `${base}+${sha.slice(0, 7)}` : base;
}
