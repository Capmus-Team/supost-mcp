import { afterEach, describe, expect, it } from "vitest";
import { SupostApiError } from "../src/http.js";
import { sendMessage } from "../src/supost.js";
import { fetchStub, jsonResponse, noSleep } from "./helpers.js";

const PARAMS = {
  post_id: 130088421,
  message: "Hi, is this still available?",
  reply_to_email: "buyer@example.com",
};

const PENDING = {
  status: "pending_verification",
  email: "buyer@example.com",
  detail: "A confirmation link has been emailed to this address.",
};

describe("sendMessage", () => {
  it("POSTs the params as JSON and returns the pending result", async () => {
    const requests: Array<{ url: string; init?: { method?: string; body?: string; headers?: Record<string, string> } }> = [];
    const fetchImpl = async (
      url: string,
      init?: { method?: string; body?: string; headers?: Record<string, string> }
    ) => {
      requests.push({ url, init });
      return jsonResponse(PENDING, 202);
    };

    const result = await sendMessage(PARAMS, { fetchImpl, sleep: noSleep });

    expect(result).toEqual(PENDING);
    expect(requests).toHaveLength(1);
    const { url, init } = requests[0]!;
    expect(new URL(url).pathname).toBe("/api/public/messages");
    expect(init?.method).toBe("POST");
    expect(init?.headers?.["content-type"]).toBe("application/json");
    expect(JSON.parse(init?.body ?? "")).toEqual(PARAMS);
  });

  it("surfaces structured API errors (e.g. post_not_found)", async () => {
    const { fetchImpl } = fetchStub([
      jsonResponse(
        { error: "post_not_found", message: "No active listing with this id." },
        404
      ),
    ]);
    await expect(
      sendMessage(PARAMS, { fetchImpl, sleep: noSleep })
    ).rejects.toMatchObject({ code: "post_not_found", status: 404 });
  });

  it("rejects an unexpected response shape", async () => {
    const { fetchImpl } = fetchStub([jsonResponse({ ok: true }, 202)]);
    await expect(
      sendMessage(PARAMS, { fetchImpl, sleep: noSleep })
    ).rejects.toBeInstanceOf(SupostApiError);
  });

  describe("trusted-agent API key", () => {
    afterEach(() => {
      delete process.env.SUPOST_API_KEY;
    });

    it("sends x-supost-api-key when SUPOST_API_KEY is set", async () => {
      process.env.SUPOST_API_KEY = "test-key";
      let headers: Record<string, string> | undefined;
      const fetchImpl = async (
        _url: string,
        init?: { headers?: Record<string, string> }
      ) => {
        headers = init?.headers;
        return jsonResponse(PENDING, 202);
      };
      await sendMessage(PARAMS, { fetchImpl, sleep: noSleep });
      expect(headers?.["x-supost-api-key"]).toBe("test-key");
    });

    it("omits the header when the env is unset", async () => {
      let headers: Record<string, string> | undefined;
      const fetchImpl = async (
        _url: string,
        init?: { headers?: Record<string, string> }
      ) => {
        headers = init?.headers;
        return jsonResponse(PENDING, 202);
      };
      await sendMessage(PARAMS, { fetchImpl, sleep: noSleep });
      expect(headers?.["x-supost-api-key"]).toBeUndefined();
    });
  });

  it("retries once on 429, resending the same POST body", async () => {
    const bodies: Array<string | undefined> = [];
    const responses = [
      jsonResponse({ error: "rate_limited", message: "slow down" }, 429),
      jsonResponse(PENDING, 202),
    ];
    const fetchImpl = async (
      _url: string,
      init?: { body?: string }
    ) => {
      bodies.push(init?.body);
      return responses.shift()!;
    };

    const result = await sendMessage(PARAMS, { fetchImpl, sleep: noSleep });
    expect(result.status).toBe("pending_verification");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
  });
});
