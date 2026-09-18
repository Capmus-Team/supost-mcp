import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";

async function connectedClient() {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

const NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = NODE_ENV;
  delete process.env.TOOL_LOG_URL;
  delete process.env.TOOL_LOG_KEY;
  delete process.env.SUPOST_STATUS_POLL_INTERVAL_MS;
  delete process.env.SUPOST_STATUS_POLL_ATTEMPTS;
  vi.unstubAllGlobals();
});

const STATUS_KEY = "3f0c2a9e-6b1d-4c2e-9a7f-1b2c3d4e5f60";
const SEND_ARGS = {
  post_id: 42,
  message: "Hi, is this still available?",
  reply_to_email: "buyer@example.com",
};

/** Routes the messages POST and the status RPC poll to canned responses,
 *  with the in-call poll made instant. */
function stubMessageFlow(pending: unknown, statuses: unknown[]) {
  process.env.SUPOST_STATUS_POLL_INTERVAL_MS = "0";
  const queue = [...statuses];
  const polls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.includes("/rest/v1/rpc/get_guest_verification_status")) {
      polls.push(String(init?.body));
      const next = queue.shift() ?? [];
      return new Response(JSON.stringify(next), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(pending), {
      status: 202,
      headers: { "content-type": "application/json" },
    });
  });
  return polls;
}

function firstText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text: string }> }).content;
  return content?.[0]?.text ?? "";
}

describe("MCP server", () => {
  it("exposes exactly the published tools", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "check_message_status",
      "create_post",
      "get_listing",
      "get_market_stats",
      "list_categories",
      "search_listings",
      "send_message",
    ]);
  });

  it("send_message POSTs to the public messages API and reports pending, not sent", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return new Response(
        JSON.stringify({ status: "pending_verification", email: "buyer@example.com" }),
        { status: 202, headers: { "content-type": "application/json" } }
      );
    });
    const client = await connectedClient();
    const result = await client.callTool({
      name: "send_message",
      arguments: {
        post_id: 42,
        message: "Hi, is this still available?",
        reply_to_email: "buyer@example.com",
      },
    });
    expect(result.isError).toBeFalsy();
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/api/public/messages");
    expect(requests[0]?.init?.method).toBe("POST");
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain("pending");
    expect(content[0]?.text).toContain("confirmation link");
  });

  it("send_message reports the confirmation email as sent when the poll says so, with the status_key", async () => {
    const polls = stubMessageFlow(
      { status: "pending_verification", email: "buyer@example.com", status_key: STATUS_KEY },
      [[{ status: "sent", reason: null }]]
    );
    const client = await connectedClient();
    const result = await client.callTool({ name: "send_message", arguments: SEND_ARGS });
    expect(result.isError).toBeFalsy();
    expect(polls).toHaveLength(1);
    expect(JSON.parse(polls[0]!)).toEqual({ p_status_key: STATUS_KEY });
    const text = firstText(result);
    expect(text).toContain(`"status_key": "${STATUS_KEY}"`);
    expect(text).toContain('"confirmation_email": "sent"');
    expect(text).toContain("pending confirmation, not sent");
    expect(text).toContain("accepted by the mail server");
  });

  it("send_message keeps polling while queued and points the agent at check_message_status", async () => {
    process.env.SUPOST_STATUS_POLL_ATTEMPTS = "2";
    const polls = stubMessageFlow(
      { status: "pending_verification", email: "buyer@example.com", status_key: STATUS_KEY },
      [[{ status: "queued", reason: null }], [{ status: "queued", reason: null }]]
    );
    const client = await connectedClient();
    const result = await client.callTool({ name: "send_message", arguments: SEND_ARGS });
    expect(result.isError).toBeFalsy();
    expect(polls).toHaveLength(2);
    const text = firstText(result);
    expect(text).toContain('"confirmation_email": "queued"');
    expect(text).toContain(`check_message_status with status_key ${STATUS_KEY}`);
  });

  it("send_message reports a bounced confirmation email as email_undeliverable, not pending", async () => {
    stubMessageFlow(
      { status: "pending_verification", email: "buyer@example.com", status_key: STATUS_KEY },
      [[{ status: "failed", reason: "mailbox_unknown" }]]
    );
    const client = await connectedClient();
    const result = await client.callTool({ name: "send_message", arguments: SEND_ARGS });
    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(JSON.parse(text.split("\n\n")[0]!)).toEqual({
      status: "email_undeliverable",
      reason: "mailbox_unknown",
      email: "buyer@example.com",
      status_key: STATUS_KEY,
      message:
        "The mail server for buyer@example.com says that mailbox doesn't exist. Check the spelling, or use another address.",
    });
    expect(text).toContain("Do not resubmit the same address");
    expect(text).not.toContain("check your inbox");
  });

  it("send_message turns the API's 422 email_undeliverable into the same outcome", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          error: "email_undeliverable",
          reason: "no_mx",
          email: "buyer@example.com",
          message: "buyer@example.com can't receive mail. Check the spelling of the address.",
        }),
        { status: 422, headers: { "content-type": "application/json" } }
      )
    );
    const client = await connectedClient();
    const result = await client.callTool({ name: "send_message", arguments: SEND_ARGS });
    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(JSON.parse(text.split("\n\n")[0]!)).toMatchObject({
      status: "email_undeliverable",
      reason: "no_mx",
      email: "buyer@example.com",
      status_key: null,
    });
    expect(text).toContain("Ask the user for a different, working email address");
  });

  it("send_message still answers pending (no poll) when the API returns no status_key", async () => {
    const polls = stubMessageFlow(
      { status: "pending_verification", email: "buyer@example.com" },
      [[{ status: "sent", reason: null }]]
    );
    const client = await connectedClient();
    const result = await client.callTool({ name: "send_message", arguments: SEND_ARGS });
    expect(result.isError).toBeFalsy();
    expect(polls).toHaveLength(0);
    const text = firstText(result);
    expect(text).toContain('"status_key": null');
    expect(text).toContain('"confirmation_email": "unknown"');
  });

  it("check_message_status reports the poll verdict; failed is an error result", async () => {
    stubMessageFlow({}, [
      [{ status: "sent", reason: null }],
      [{ status: "failed", reason: "suppressed" }],
      [],
    ]);
    const client = await connectedClient();

    const sent = await client.callTool({ name: "check_message_status", arguments: { status_key: STATUS_KEY } });
    expect(sent.isError).toBeFalsy();
    expect(JSON.parse(firstText(sent))).toMatchObject({ status_key: STATUS_KEY, status: "sent", reason: null });

    const failed = await client.callTool({ name: "check_message_status", arguments: { status_key: STATUS_KEY } });
    expect(failed.isError).toBe(true);
    const failedBody = JSON.parse(firstText(failed));
    expect(failedBody).toMatchObject({ status: "failed", reason: "suppressed" });
    expect(failedBody.detail).toContain("Do not resubmit the same address");

    const unknown = await client.callTool({ name: "check_message_status", arguments: { status_key: STATUS_KEY } });
    expect(unknown.isError).toBeFalsy();
    expect(JSON.parse(firstText(unknown))).toMatchObject({ status: "unknown", reason: null });
  });

  it("check_message_status rejects a malformed key at the schema", async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: "check_message_status", arguments: { status_key: "nope" } });
    expect(result.isError).toBe(true);
  });

  it("search_listings round-trips params to the API and returns JSON text", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return new Response(
        JSON.stringify({ listings: [], next_cursor: null }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const client = await connectedClient();
    const result = await client.callTool({
      name: "search_listings",
      arguments: { q: "bike", max_price: 100, limit: 5 },
    });
    const requested = new URL(urls[0] ?? "");
    expect(requested.pathname).toBe("/api/public/listings");
    expect(requested.searchParams.get("q")).toBe("bike");
    expect(requested.searchParams.get("max_price")).toBe("100");
    expect(requested.searchParams.get("limit")).toBe("5");
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0]?.text ?? "")).toEqual({
      listings: [],
      next_cursor: null,
    });
    expect(result.isError).toBeFalsy();
  });

  it("captures sanitized PostHog props but logs full args to the DB RPC", async () => {
    process.env.NODE_ENV = "production";
    process.env.TOOL_LOG_URL = "https://db.test.supabase.co";
    process.env.TOOL_LOG_KEY = "srk";
    const requests: Array<{ url: string; body: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push({ url, body: String(init?.body ?? "") });
      if (url.includes("/api/public/messages")) {
        return new Response(
          JSON.stringify({ status: "pending_verification", email: "buyer@example.com" }),
          { status: 202, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("ok", { status: 200 });
    });
    const client = await connectedClient();
    await client.callTool({
      name: "send_message",
      arguments: {
        post_id: 42,
        message: "Hi, is this still available?",
        reply_to_email: "buyer@example.com",
      },
    });

    const posthog = requests.find((r) => r.url.includes("posthog.com"));
    expect(posthog).toBeDefined();
    const props = JSON.parse(posthog!.body).properties;
    expect(props).toMatchObject({
      tool: "send_message",
      ok: true,
      post_id: 42,
      message_chars: 28,
    });
    expect(JSON.stringify(props)).not.toContain("buyer@example.com");
    expect(JSON.stringify(props)).not.toContain("still available");

    const dbLog = requests.find((r) => r.url.includes("/rpc/log_mcp_tool_call"));
    expect(dbLog).toBeDefined();
    expect(JSON.parse(dbLog!.body)).toMatchObject({
      p_tool: "send_message",
      p_ok: true,
      p_args: {
        post_id: 42,
        message: "Hi, is this still available?",
        reply_to_email: "buyer@example.com",
      },
    });
  });

  it("upstream errors become isError tool results, not protocol failures", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({ error: "invalid_request", message: "Unknown category" }),
        { status: 400, headers: { "content-type": "application/json" } }
      )
    );
    const client = await connectedClient();
    const result = await client.callTool({
      name: "search_listings",
      arguments: { cat: "nonsense" },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain("invalid_request");
  });
});
