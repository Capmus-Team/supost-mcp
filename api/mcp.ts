import { createMcpHandler } from "mcp-handler";
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
    serverInfo: { name: "supost", version: "0.1.0" },
  },
  {
    basePath: "/api",
    maxDuration: 60,
  }
);

export { handler as GET, handler as POST, handler as DELETE };
