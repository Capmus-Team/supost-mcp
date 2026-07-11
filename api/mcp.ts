import { createMcpHandler } from "mcp-handler";
import { getBrand } from "../src/config.js";
import { registerTools } from "../src/server.js";

/**
 * Remote MCP endpoint (streamable HTTP transport) at /api/mcp, rewritten
 * from /mcp (vercel.json). Stateless: each POST gets a fresh server; no
 * Redis, no sessions, no secrets (doc 190 E3).
 */
const handler = createMcpHandler(
  (server) => {
    registerTools(server);
  },
  {
    serverInfo: { name: getBrand().key, version: "0.2.2" },
  },
  {
    basePath: "/api",
    maxDuration: 60,
  }
);

/**
 * The vercel.json rewrite forwards /mcp here, but the Request keeps the
 * original /mcp path, which mcp-handler (basePath "/api") rejects.
 * Normalize it so both /mcp and /api/mcp serve the endpoint.
 */
function normalized(request: Request): Request {
  const url = new URL(request.url);
  if (url.pathname === "/mcp") {
    url.pathname = "/api/mcp";
    return new Request(url, request);
  }
  return request;
}

const route = (request: Request) => handler(normalized(request));

export { route as GET, route as POST, route as DELETE };
