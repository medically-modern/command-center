import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "@/lib/assignedPatients/messagingApi";
import type { ItemNumber, ItemState, TimelineEntry } from "./rules";
import { callLine, defaultNumber, fillNumbers, formatDuration, liveSuggestion, mergeLiveTexts, numberHint, seenThroughFor } from "./timeline";

const T = Date.parse("2026-09-23T15:00:00Z");

const text = (id: string, at: number, over: Partial<Extract<TimelineEntry, { type: "text" }>> = {}): TimelineEntry => ({
  type: "text",
  id,
  dir: "in",
  at,
  last4: "1234",
  body: "hi",
  status: "Received",
  deliveryError: "",
  attachments: [],
  sentBy: "",
  ...over,
});

const call = (over: Partial<Extract<TimelineEntry, { type: "call" }>> = {}): Extract<TimelineEntry, { type: "call" }> => ({
  type: "call",
  id: "c1",
  dir: "in",
  at: T,
  last4: "1234",
  durationSec: 192,
  result: "",
  connected: false,
  missed: true,
  blocked: false,
  audioState: "none",
  dialedBy: "",
  recordingUri: "",
  voicemail: null,
  ...over,
});

const live = (id: number, time: string, over: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id,
  direction: "Outbound",
  text: "on its way",
  time,
  ...over,
});

describe("mergeLiveTexts", () => {
  it("⚠️⚠️ the live copy wins a collision — a Queued archive row shows the live SendingFailed", () => {
    const tl = [text("10", T, { dir: "out", status: "Queued", body: "on its way" })];
    const out = mergeLiveTexts(tl, [live(10, new Date(T).toISOString(), { messageStatus: "SendingFailed", deliveryError: "SMS-RC-410" })], "1234");
    expect(out).toHaveLength(1);
    const e = out[0] as Extract<TimelineEntry, { type: "text" }>;
    expect(e.status).toBe("SendingFailed");
    expect(e.deliveryError).toBe("SMS-RC-410");
    expect(e.live).toBe(true);
  });

  it("keeps the archive's knowledge that a photo is in our bucket", () => {
    const tl = [text("11", T, { attachments: [{ id: "5", contentType: "image/jpeg", uri: "rc://5", archived: true }] })];
    const out = mergeLiveTexts(
      tl,
      [live(11, new Date(T).toISOString(), { direction: "Inbound", attachments: [{ id: 5, contentType: "image/jpeg", uri: "rc://5" }] })],
      "1234",
    );
    const e = out[0] as Extract<TimelineEntry, { type: "text" }>;
    expect(e.attachments[0]).toMatchObject({ id: "5", archived: true });
  });

  it("appends a live-only text in time order, stamped with the number it is on", () => {
    const tl = [text("1", T - 60_000), text("3", T + 60_000)];
    const out = mergeLiveTexts(tl, [live(2, new Date(T).toISOString())], "9876");
    expect(out.map((e) => (e.type === "text" ? e.id : ""))).toEqual(["1", "2", "3"]);
    expect((out[1] as Extract<TimelineEntry, { type: "text" }>).last4).toBe("9876");
    expect((out[1] as Extract<TimelineEntry, { type: "text" }>).dir).toBe("out");
  });

  it("no live thread → the timeline, untouched (same identity)", () => {
    const tl = [text("1", T)];
    expect(mergeLiveTexts(tl, [], "1234")).toBe(tl);
  });

  it("a live message with an unreadable time is dropped, not placed at the epoch", () => {
    const out = mergeLiveTexts([text("1", T)], [live(2, "not a date")], "1234");
    expect(out).toHaveLength(1);
  });
});

describe("seenThroughFor", () => {
  it("is the newest INBOUND event on screen, never an outbound one", () => {
    const tl = [text("1", T), text("2", T + 60_000, { dir: "out" })];
    expect(seenThroughFor(tl, T - 5_000)).toBe(T);
  });
  it("counts a live-only inbound text the rep can see", () => {
    const tl = mergeLiveTexts([text("1", T)], [live(2, new Date(T + 30_000).toISOString(), { direction: "Inbound" })], "1234");
    expect(seenThroughFor(tl, T)).toBe(T + 30_000);
  });
  it("null when nothing inbound is on screen and nothing is open", () => {
    expect(seenThroughFor([text("1", T, { dir: "out" })], null)).toBeNull();
  });
});

describe("numbers", () => {
  const n = (last4: string, e164: string | null): ItemNumber => ({ hmac: last4.repeat(16), last4, e164 });

  it("defaultNumber: the number the newest inbound came in on", () => {
    const nums = [n("1111", "+15550001111"), n("2222", "+15550002222")];
    const tl = [text("1", T, { last4: "1111" }), text("2", T + 1, { last4: "2222" }), text("3", T + 2, { dir: "out", last4: "1111" })];
    expect(defaultNumber(nums, tl)?.last4).toBe("2222");
  });
  it("defaultNumber: falls back to the first reachable number", () => {
    expect(defaultNumber([n("1111", null), n("2222", "+15550002222")], [])?.last4).toBe("2222");
    expect(defaultNumber([n("1111", null)], [])).toBeNull();
  });
  it("fillNumbers: fills from the patient's own records on a UNIQUE last four only", () => {
    const nums = [n("1111", null), n("2222", null)];
    const out = fillNumbers(nums, ["(555) 000-1111", "+15559992222", "+15558882222"]);
    expect(out[0].e164).toBe("+15550001111");
    expect(out[1].e164).toBeNull(); // two candidates end 2222 — ambiguous, left alone
  });
  it("fillNumbers: same identity when nothing changes", () => {
    const nums = [n("1111", "+15550001111")];
    expect(fillNumbers(nums, ["+15550001111"])).toBe(nums);
  });
  it("numberHint names the number only when there are several", () => {
    expect(numberHint("1111", [{ last4: "1111" }])).toBe("");
    expect(numberHint("1111", [{ last4: "1111" }, { last4: "2222" }])).toBe("on ···1111");
  });
});

describe("callLine", () => {
  it("words each verdict", () => {
    expect(callLine(call())).toBe("Missed call");
    expect(callLine(call({ voicemail: { id: "v", at: T, durationSec: 20, transcript: "", audioState: "stored", audioUri: "" } }))).toBe(
      "Missed call · left a voicemail",
    );
    expect(callLine(call({ blocked: true, missed: false }))).toBe("Blocked call");
    expect(callLine(call({ connected: true, missed: false }))).toBe("Answered call · 3:12");
    expect(callLine(call({ dir: "out", connected: true, missed: false, dialedBy: "katie.tyler@medicallymodern.com" }))).toBe(
      "We called · 3:12 · Katie",
    );
    expect(callLine(call({ dir: "out", connected: false, missed: false }))).toBe("We called · no answer");
  });
  it("⚠️ a browser pickup reads as THEIR call — RingCentral logged it backwards (2026-09-25)", () => {
    // Josh's own test call: answered in the browser, logged as a single
    // Outbound/Accepted record toward the caller. The gateway marks it from
    // call_events; the wording must say who really called whom.
    expect(callLine(call({ dir: "out", connected: true, missed: false, pickedUp: true }))).toBe(
      "They called — we picked up · 3:12",
    );
  });
  it("formatDuration", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65)).toBe("1:05");
  });
});

describe("liveSuggestion", () => {
  const state = (over: Partial<ItemState> = {}): ItemState => ({
    open: true,
    openedBy: { at: T, kind: "text" },
    openCount: 1,
    waitMs: 0,
    over: false,
    reopened: false,
    lastInbound: null,
    previewKind: "text",
    preview: "",
    lastResolution: null,
    suggestion: null,
    attempts: [],
    stickyWaitMs: 0,
    lastAt: T,
    newestOpenAt: T,
    ...over,
  });

  it("a text a person just sent here suggests Texted at once", () => {
    const tl = [text("1", T), text("2", T + 60_000, { dir: "out", sentBy: "katie@medicallymodern.com" })];
    expect(liveSuggestion(state(), tl)).toEqual({ how: "texted", at: T + 60_000, by: "katie@medicallymodern.com" });
  });

  it("⚠️ a text with no sender (an automation, the RC app) suggests nothing", () => {
    const tl = [text("1", T), text("2", T + 60_000, { dir: "out", sentBy: "" })];
    expect(liveSuggestion(state(), tl)).toBeNull();
  });

  it("only what was sent AFTER the item opened", () => {
    const tl = [text("0", T - 60_000, { dir: "out", sentBy: "k@x.com" }), text("1", T)];
    expect(liveSuggestion(state(), tl)).toBeNull();
  });

  it("never replaces a newer gateway suggestion (a connected callback)", () => {
    const called = { how: "called" as const, at: T + 120_000, by: "" };
    const tl = [text("2", T + 60_000, { dir: "out", sentBy: "k@x.com" })];
    expect(liveSuggestion(state({ suggestion: called }), tl)).toBe(called);
  });

  it("nothing on a closed item", () => {
    const tl = [text("2", T + 60_000, { dir: "out", sentBy: "k@x.com" })];
    expect(liveSuggestion(state({ open: false, openedBy: null }), tl)).toBeNull();
  });

  it("⚠️ a text RingCentral gave up on never suggests Texted (§5.5)", () => {
    const tl = [text("2", T + 60_000, { dir: "out", sentBy: "k@x.com", status: "SendingFailed" })];
    expect(liveSuggestion(state(), tl)).toBeNull();
    // An older one that went through still does.
    const ok = text("1", T + 30_000, { dir: "out", sentBy: "k@x.com", status: "Delivered" });
    expect(liveSuggestion(state(), [ok, ...tl])).toEqual({ how: "texted", at: T + 30_000, by: "k@x.com" });
    // In flight is not failed.
    const queued = [text("3", T + 60_000, { dir: "out", sentBy: "k@x.com", status: "Queued" })];
    expect(liveSuggestion(state(), queued)?.how).toBe("texted");
  });

  it("⚠️ withdraws the gateway's Texted when the live thread now shows that text failed", () => {
    const gw = { how: "texted" as const, at: T + 60_000, by: "k@x.com" };
    const failed = [text("2", T + 60_000, { dir: "out", sentBy: "k@x.com", status: "SendingFailed" })];
    expect(liveSuggestion(state({ suggestion: gw }), failed)).toBeNull();
    // …but leaves it alone while that text is fine,
    const fine = [text("2", T + 60_000, { dir: "out", sentBy: "k@x.com", status: "Sent" })];
    expect(liveSuggestion(state({ suggestion: gw }), fine)).toBe(gw);
    // …and never touches a Called suggestion.
    const called = { how: "called" as const, at: T + 60_000, by: "" };
    expect(liveSuggestion(state({ suggestion: called }), failed)).toBe(called);
  });
});
