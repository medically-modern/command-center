import { describe, expect, it, vi } from "vitest";
import { confirmSmsAccepted } from "./smsSend.mjs";

/**
 * Guards the 5xx-but-delivered workaround (CLAUDE.md §5.5). This account's
 * POST /sms returns 500 while still delivering, so a 5xx is confirmed against
 * the message store before it's reported as a failure.
 *
 * Both directions matter:
 *   a false NEGATIVE → the rep re-sends and the patient is texted twice;
 *   a false POSITIVE → a genuinely failed text is reported as sent and nobody
 *                      ever follows up.
 */

const TO = "+13475551234";
const TEXT = "Your supplies shipped today.";

/** message-store response containing `records`. */
const store = (records) => ({ ok: true, json: async () => ({ records }) });
const sent = (text, to = TO) => ({ subject: text, to: [{ phoneNumber: to }] });
/** No real waiting between retries. */
const noSleep = () => Promise.resolve();

describe("confirmSmsAccepted", () => {
  it("confirms when the exact message to the right number is in the store", async () => {
    const rcFetch = vi.fn(async () => store([sent(TEXT)]));
    await expect(confirmSmsAccepted({ rcFetch, to: TO, text: TEXT, sleep: noSleep })).resolves.toBe(true);
    expect(rcFetch).toHaveBeenCalledTimes(1);
  });

  it("reports failure when nothing matching is there", async () => {
    const rcFetch = vi.fn(async () => store([]));
    await expect(confirmSmsAccepted({ rcFetch, to: TO, text: TEXT, sleep: noSleep })).resolves.toBe(false);
    expect(rcFetch).toHaveBeenCalledTimes(3); // exhausts its retries before giving up
  });

  // Two different messages to one patient in the same minute is ordinary. If a
  // near-match counted, a real failure would be reported as a success.
  it("does NOT accept a different message to the same number", async () => {
    const rcFetch = async () => store([sent("Something else entirely")]);
    await expect(confirmSmsAccepted({ rcFetch, to: TO, text: TEXT, sleep: noSleep })).resolves.toBe(false);
  });

  it("does NOT accept the same message to a different number", async () => {
    const rcFetch = async () => store([sent(TEXT, "+13475559999")]);
    await expect(confirmSmsAccepted({ rcFetch, to: TO, text: TEXT, sleep: noSleep })).resolves.toBe(false);
  });

  // The message takes a moment to land, which is the whole reason for retrying.
  it("finds a message that only appears on a later attempt", async () => {
    let n = 0;
    const rcFetch = vi.fn(async () => (++n < 3 ? store([]) : store([sent(TEXT)])));
    await expect(confirmSmsAccepted({ rcFetch, to: TO, text: TEXT, sleep: noSleep })).resolves.toBe(true);
    expect(rcFetch).toHaveBeenCalledTimes(3);
  });

  it("keeps trying through a transient read failure rather than assuming failure", async () => {
    let n = 0;
    const rcFetch = vi.fn(async () => {
      if (++n === 1) throw new Error("network blip");
      return store([sent(TEXT)]);
    });
    await expect(confirmSmsAccepted({ rcFetch, to: TO, text: TEXT, sleep: noSleep })).resolves.toBe(true);
  });

  it("treats a non-ok message-store read as inconclusive, not as proof of failure", async () => {
    let n = 0;
    const rcFetch = async () => (++n === 1 ? { ok: false } : store([sent(TEXT)]));
    await expect(confirmSmsAccepted({ rcFetch, to: TO, text: TEXT, sleep: noSleep })).resolves.toBe(true);
  });

  it("matches on the last 10 digits, so formatting differences don't cause a false negative", async () => {
    const rcFetch = async () => store([{ subject: TEXT, to: [{ phoneNumber: "3475551234" }] }]);
    await expect(confirmSmsAccepted({ rcFetch, to: TO, text: TEXT, sleep: noSleep })).resolves.toBe(true);
  });

  it("reads `text` as well as `subject`, since the store uses both", async () => {
    const rcFetch = async () => store([{ text: TEXT, to: [{ phoneNumber: TO }] }]);
    await expect(confirmSmsAccepted({ rcFetch, to: TO, text: TEXT, sleep: noSleep })).resolves.toBe(true);
  });

  it("refuses to confirm without a usable recipient or body", async () => {
    const rcFetch = vi.fn(async () => store([sent(TEXT)]));
    await expect(confirmSmsAccepted({ rcFetch, to: "", text: TEXT, sleep: noSleep })).resolves.toBe(false);
    await expect(confirmSmsAccepted({ rcFetch, to: TO, text: "", sleep: noSleep })).resolves.toBe(false);
    expect(rcFetch).not.toHaveBeenCalled();
  });

  it("scopes the lookback to just before the send", async () => {
    let seen = "";
    const rcFetch = async (path) => {
      seen = path;
      return store([sent(TEXT)]);
    };
    const sentAtMs = Date.parse("2026-08-04T18:00:00.000Z");
    await confirmSmsAccepted({ rcFetch, to: TO, text: TEXT, sentAtMs, sleep: noSleep });
    expect(seen).toContain(encodeURIComponent("2026-08-04T17:59:00.000Z"));
    expect(seen).toContain("direction=Outbound");
  });
});
