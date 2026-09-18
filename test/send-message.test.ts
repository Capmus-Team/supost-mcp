import { afterEach, describe, expect, it } from "vitest";
import { SupostApiError } from "../src/http.js";
import {
  describeUndeliverable,
  getMessageDeliveryStatus,
  sendMessage,
  waitForMessageDelivery,
} from "../src/supost.js";
import { fetchStub, jsonResponse, noSleep } from "./helpers.js";

const PARAMS = {
  post_id: 130088421,
  message: "Hi, is this still available?",
  reply_to_email: "buyer@example.com",
};

const STATUS_KEY = "3f0c2a9e-6b1d-4c2e-9a7f-1b2c3d4e5f60";

const PENDING = {
  status: "pending_verification",
  email: "buyer@example.com",
  status_key: STATUS_KEY,
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

  it("reports a null status_key when the API omits it (pre-2026-09-17 responses)", async () => {
    const { fetchImpl } = fetchStub([
      jsonResponse({ status: "pending_verification", email: "buyer@example.com" }, 202),
    ]);
    const result = await sendMessage(PARAMS, { fetchImpl, sleep: noSleep });
    expect(result).toEqual({ status: "pending_verification", email: "buyer@example.com", status_key: null });
  });

  it("surfaces a 422 email_undeliverable with its reason and email in details", async () => {
    const { fetchImpl } = fetchStub([
      jsonResponse(
        {
          error: "email_undeliverable",
          reason: "mailbox_unknown",
          email: "buyer@example.com",
          message: "The mail server for buyer@example.com says that mailbox doesn't exist. Check the spelling, or use another address.",
        },
        422
      ),
    ]);
    await expect(
      sendMessage(PARAMS, { fetchImpl, sleep: noSleep })
    ).rejects.toMatchObject({
      code: "email_undeliverable",
      status: 422,
      details: { reason: "mailbox_unknown", email: "buyer@example.com" },
    });
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

describe("getMessageDeliveryStatus", () => {
  afterEach(() => {
    delete process.env.SUPOST_STATUS_URL;
    delete process.env.SUPOST_STATUS_KEY;
  });

  it("POSTs the status_key to the anon RPC with the publishable key", async () => {
    process.env.SUPOST_STATUS_URL = "https://db.example.test/";
    process.env.SUPOST_STATUS_KEY = "sb_publishable_test";
    const requests: Array<{ url: string; init?: { method?: string; body?: string; headers?: Record<string, string> } }> = [];
    const fetchImpl = async (
      url: string,
      init?: { method?: string; body?: string; headers?: Record<string, string> }
    ) => {
      requests.push({ url, init });
      return jsonResponse([{ status: "sent", reason: null }]);
    };

    const result = await getMessageDeliveryStatus(STATUS_KEY, { fetchImpl, sleep: noSleep });

    expect(result).toEqual({ status: "sent", reason: null });
    const { url, init } = requests[0]!;
    expect(url).toBe("https://db.example.test/rest/v1/rpc/get_guest_verification_status");
    expect(init?.method).toBe("POST");
    expect(init?.headers?.apikey).toBe("sb_publishable_test");
    expect(init?.headers?.authorization).toBe("Bearer sb_publishable_test");
    expect(JSON.parse(init?.body ?? "")).toEqual({ p_status_key: STATUS_KEY });
  });

  it("classifies a failed row and defaults an unknown reason to other", async () => {
    const { fetchImpl } = fetchStub([
      jsonResponse([{ status: "failed", reason: "no_mx" }]),
      jsonResponse([{ status: "failed", reason: "something-new" }]),
    ]);
    expect(await getMessageDeliveryStatus(STATUS_KEY, { fetchImpl })).toEqual({ status: "failed", reason: "no_mx" });
    expect(await getMessageDeliveryStatus(STATUS_KEY, { fetchImpl })).toEqual({ status: "failed", reason: "other" });
  });

  it("reports unknown for an unrecognised key (empty RPC result) without calling out for a malformed one", async () => {
    const { fetchImpl, urls } = fetchStub([jsonResponse([])]);
    expect(await getMessageDeliveryStatus(STATUS_KEY, { fetchImpl })).toEqual({ status: "unknown", reason: null });
    expect(await getMessageDeliveryStatus("not-a-uuid", { fetchImpl })).toEqual({ status: "unknown", reason: null });
    expect(urls).toHaveLength(1);
  });

  it("is disabled (unknown, no request) when SUPOST_STATUS_KEY is empty", async () => {
    process.env.SUPOST_STATUS_KEY = "";
    const { fetchImpl, urls } = fetchStub([jsonResponse([{ status: "sent" }])]);
    expect(await getMessageDeliveryStatus(STATUS_KEY, { fetchImpl })).toEqual({ status: "unknown", reason: null });
    expect(urls).toHaveLength(0);
  });

  it("throws a structured status_unavailable on an HTTP failure", async () => {
    const { fetchImpl } = fetchStub([jsonResponse({ message: "nope" }, 500)]);
    await expect(getMessageDeliveryStatus(STATUS_KEY, { fetchImpl })).rejects.toMatchObject({
      code: "status_unavailable",
      status: 500,
    });
  });
});

describe("waitForMessageDelivery", () => {
  it("stops at the first verdict and sleeps one interval before each check", async () => {
    const slept: number[] = [];
    const sleep = async (ms: number) => {
      slept.push(ms);
    };
    const { fetchImpl, urls } = fetchStub([
      jsonResponse([{ status: "queued", reason: null }]),
      jsonResponse([{ status: "failed", reason: "suppressed" }]),
      jsonResponse([{ status: "sent", reason: null }]),
    ]);
    const result = await waitForMessageDelivery(STATUS_KEY, { fetchImpl, sleep }, { attempts: 4, intervalMs: 7 });
    expect(result).toEqual({ status: "failed", reason: "suppressed" });
    expect(urls).toHaveLength(2);
    expect(slept).toEqual([7, 7]);
  });

  it("returns queued after the attempts run out, treating lookup errors as still queued", async () => {
    const { fetchImpl, urls } = fetchStub([
      jsonResponse({ message: "boom" }, 500),
      jsonResponse([{ status: "queued", reason: null }]),
    ]);
    const result = await waitForMessageDelivery(STATUS_KEY, { fetchImpl, sleep: noSleep }, { attempts: 2, intervalMs: 0 });
    expect(result).toEqual({ status: "queued", reason: null });
    expect(urls).toHaveLength(2);
  });

  it("gives up immediately on an unrecognised key", async () => {
    const { fetchImpl, urls } = fetchStub([jsonResponse([]), jsonResponse([])]);
    const result = await waitForMessageDelivery(STATUS_KEY, { fetchImpl, sleep: noSleep }, { attempts: 3, intervalMs: 0 });
    expect(result).toEqual({ status: "unknown", reason: null });
    expect(urls).toHaveLength(1);
  });
});

describe("describeUndeliverable", () => {
  it("words a dead Stanford mailbox with the alumni/personal fix", () => {
    expect(describeUndeliverable("ghost@stanford.edu", "mailbox_unknown")).toBe(
      "Stanford's mail server says ghost@stanford.edu doesn't exist. If they have graduated or left Stanford, use their alumni or personal address."
    );
  });

  it("words other addresses factually, then the fix, and never apologises", () => {
    for (const reason of ["mailbox_unknown", "no_mx", "suppressed", "other"] as const) {
      const text = describeUndeliverable("buyer@example.com", reason);
      expect(text).toContain("buyer@example.com");
      expect(text.toLowerCase()).not.toContain("sorry");
    }
    expect(describeUndeliverable("buyer@example.com", "no_mx")).toContain("can't receive mail");
    expect(describeUndeliverable("buyer@example.com", "suppressed")).toContain("isn't being delivered");
  });
});
