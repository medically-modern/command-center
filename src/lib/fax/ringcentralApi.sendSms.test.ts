/**
 * sendSms — the RC send API on this account returns bare 500s for messages it
 * has actually accepted (they land in the message store and deliver). These
 * tests pin the confirm-on-5xx behavior: a 5xx only surfaces as an error when
 * the read-back finds no matching just-created outbound message.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendSms } from "./ringcentralApi";

const okToken = { access_token: "tok", expires_in: 3600 };

function jsonRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Route the module's three call shapes: token grant, SMS POST, store read. */
function mockFetch(opts: {
  smsStatus: number;
  smsBody?: unknown;
  storeRecords?: Array<{ subject: string; to: Array<{ phoneNumber: string }> }>;
}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/restapi/oauth/token")) return jsonRes(200, okToken);
    if (url.includes("/message-store")) return jsonRes(200, { records: opts.storeRecords ?? [] });
    if (url.endsWith("/extension/~/sms"))
      return jsonRes(opts.smsStatus, opts.smsBody ?? { message: "Internal Server Error. Consult RC Support." });
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe("sendSms", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resolves on a clean 200", async () => {
    const f = mockFetch({ smsStatus: 200, smsBody: { id: 1, messageStatus: "Queued" } });
    vi.stubGlobal("fetch", f);
    await expect(sendSms("310-213-8290", "hello")).resolves.toBeUndefined();
    // no read-back needed on success
    expect(f.mock.calls.some(([u]) => String(u).includes("/message-store"))).toBe(false);
  });

  it("treats a 500 as success when the message shows up in the store", async () => {
    const f = mockFetch({
      smsStatus: 500,
      storeRecords: [{ subject: "hello", to: [{ phoneNumber: "+13102138290" }] }],
    });
    vi.stubGlobal("fetch", f);
    const p = sendSms("310-213-8290", "hello");
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
  });

  it("throws RC's message on a 500 when no matching message was created", async () => {
    const f = mockFetch({ smsStatus: 500, storeRecords: [] });
    vi.stubGlobal("fetch", f);
    const p = sendSms("310-213-8290", "hello");
    p.catch(() => {}); // avoid unhandled-rejection noise while timers run
    await vi.runAllTimersAsync();
    await expect(p).rejects.toThrow("Internal Server Error. Consult RC Support.");
    // polled the store before giving up
    expect(f.mock.calls.some(([u]) => String(u).includes("/message-store"))).toBe(true);
  });

  it("does not read the store back on a 4xx rejection", async () => {
    const f = mockFetch({
      smsStatus: 400,
      smsBody: { errorCode: "InvalidParameter", message: "Parameter [from] value is invalid." },
    });
    vi.stubGlobal("fetch", f);
    const p = sendSms("310-213-8290", "hello");
    p.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(p).rejects.toThrow("Parameter [from] value is invalid.");
    expect(f.mock.calls.some(([u]) => String(u).includes("/message-store"))).toBe(false);
  });

  it("only counts a store hit with the exact text and recipient", async () => {
    const f = mockFetch({
      smsStatus: 500,
      // same recipient, different text — a previous message must not confirm this send
      storeRecords: [{ subject: "different text", to: [{ phoneNumber: "+13102138290" }] }],
    });
    vi.stubGlobal("fetch", f);
    const p = sendSms("310-213-8290", "hello");
    p.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(p).rejects.toThrow();
  });
});
