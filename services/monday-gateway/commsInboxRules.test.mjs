import { describe, it, expect } from "vitest";
import {
  DISPLAY_WINDOW_MS,
  LEFT_VM_LINK_MS,
  MAX_MIRROR_ATTEMPTS,
  NOTE_MAX,
  OVER_AFTER_MS,
  STALE_CLAIM_MS,
  UNDO_WINDOW_MS,
  badgeCounts,
  buildInbox,
  buildTimeline,
  callConnected,
  callEvent,
  callWentToVoicemail,
  canAddNote,
  canUndo,
  countedWaitMs,
  dedupeRecords,
  dialerFor,
  etMidnightUtc,
  filterInbox,
  groupKeyFor,
  inboxHealth,
  isBlockedCall,
  isFaxCall,
  isReplyToAutomation,
  itemState,
  leftVmCallFor,
  mirrorPending,
  normalizeNote,
  noteTargetFor,
  opensItem,
  parseKey,
  planResolve,
  resolutionFromRow,
  resolveTarget,
  shadowReport,
  slaReport,
  stagePill,
  textEvent,
  voicemailEvent,
} from "./commsInboxRules.mjs";

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const A = "a".repeat(64); // a patient's primary number (HMAC)
const B = "b".repeat(64); // the same patient's alternate
const U = "c".repeat(64); // an unknown number

const H = 3600_000;
const MIN = 60_000;
const at = (iso) => new Date(iso).getTime();

// September 2026 is Eastern DAYLIGHT time (UTC-4).
const TUE_9AM = at("2026-09-22T13:00:00Z");
const FRI_6PM = at("2026-09-18T22:00:00Z");
const SAT_10AM = at("2026-09-19T14:00:00Z");
const SUN_5PM = at("2026-09-20T21:00:00Z");
const MON_9AM = at("2026-09-21T13:00:00Z");
const MON_6PM = at("2026-09-21T22:00:00Z");
const TUE_0AM = at("2026-09-22T04:00:00Z");

let seq = 0;
const text = (hmac, t, over = {}) => ({
  kind: "text",
  id: `t${++seq}`,
  dir: "in",
  at: t,
  hmac,
  last4: hmac === A ? "0101" : hmac === B ? "0202" : "0303",
  body: "When does my order ship?",
  status: "Received",
  deliveryError: "",
  attachments: [],
  sentBy: "",
  ...over,
});
const call = (hmac, t, over = {}) => ({
  kind: "call",
  id: `c${++seq}`,
  sessionId: "",
  dir: "in",
  at: t,
  hmac,
  last4: "0101",
  result: "Missed",
  legResults: [],
  durationSec: 0,
  audioState: "none",
  dialedBy: "",
  ...over,
});
const vm = (hmac, t, over = {}) => ({
  kind: "voicemail",
  id: `v${++seq}`,
  dir: "in",
  at: t,
  hmac,
  last4: "0101",
  durationSec: 30,
  transcript: "Hi, calling about my sensors",
  audioState: "stored",
  ...over,
});
let rid = 0;
const res = (hmacs, how, t, over = {}) => {
  const resolutionId = over.resolutionId ?? `r${++rid}`;
  return [hmacs].flat().map((h) => ({
    id: `${resolutionId}-${h.slice(0, 2)}`,
    resolutionId,
    hmac: h,
    how,
    note: over.note ?? (how === "called" ? "Told her Friday" : ""),
    coversThrough: over.coversThrough ?? t,
    resolvedBy: over.resolvedBy ?? "katie@medicallymodern.com",
    resolvedAt: t,
    itemBoard: over.itemBoard ?? 18407459988,
    itemId: over.itemId ?? "1001",
    mirrorClaimedAt: over.mirrorClaimedAt ?? null,
    mirrorAttempts: over.mirrorAttempts ?? 0,
    mirroredTo: over.mirroredTo ?? "",
    mirrorError: over.mirrorError ?? "",
    undoneBy: over.undoneAt ? "katie@medicallymodern.com" : "",
    undoneAt: over.undoneAt ?? null,
  }));
};

/* ── the missed-call verdict ─────────────────────────────────────────────── */

describe("callConnected — the SPA's leg rule over the archive's columns", () => {
  it("reads a connected result, or any connected LEG", () => {
    expect(callConnected({ result: "Call connected" })).toBe(true);
    // A claimed (forwarded) call: the parent reads missed, the leg connected.
    expect(callConnected({ result: "Missed", legResults: ["Missed", "Accepted"] })).toBe(true);
  });
  it("a voicemail is not a conversation, whatever its duration", () => {
    expect(callConnected({ result: "Voicemail", durationSec: 40 })).toBe(false);
    expect(callConnected({ result: "", legResults: ["Voicemail"], durationSec: 40 })).toBe(false);
    expect(callWentToVoicemail({ legResults: ["Message Left"] })).toBe(true);
  });
  it("a NAMED missed outcome outranks ring time in the duration", () => {
    expect(callConnected({ result: "Missed", durationSec: 18 })).toBe(false);
    expect(callConnected({ result: "Answered Not Accepted", durationSec: 18 })).toBe(false);
  });
  it("an unrecognised result falls back to talk time", () => {
    expect(callConnected({ result: "Something New", durationSec: 5 })).toBe(true);
    expect(callConnected({ result: "Something New", durationSec: 0 })).toBe(false);
  });
  it("knows a blocked call", () => {
    expect(isBlockedCall({ result: "Blocked" })).toBe(true);
    expect(isBlockedCall({ result: "Missed" })).toBe(false);
  });
});

/* ── what opens an item ──────────────────────────────────────────────────── */

describe("opensItem", () => {
  it("an inbound text, a missed inbound call, a voicemail", () => {
    expect(opensItem(text(A, TUE_9AM))).toBe(true);
    expect(opensItem(call(A, TUE_9AM))).toBe(true);
    expect(opensItem(vm(A, TUE_9AM))).toBe(true);
  });
  it("never our own replies, an answered call, or a blocked caller", () => {
    expect(opensItem(text(A, TUE_9AM, { dir: "out" }))).toBe(false);
    expect(opensItem(call(A, TUE_9AM, { result: "Accepted", durationSec: 90 }))).toBe(false);
    expect(opensItem(call(A, TUE_9AM, { result: "Blocked" }))).toBe(false);
  });
  it("never an event with no number — a withheld caller cannot be grouped or resolved", () => {
    expect(opensItem(text("", TUE_9AM))).toBe(false);
    expect(opensItem(call(null, TUE_9AM))).toBe(false);
  });
  // ⚠️⚠️ The call log carries faxes and call_archive keeps them. A failed
  // received fax (Receive Error, 0s) reads to callConnected as unanswered, so
  // it opened a "Missed call" item — the 2026-09-23 review reproduced it.
  it("⚠️ never a FAX — the call log carries them, and a failed one reads as unanswered", () => {
    const fax = call(A, TUE_9AM, { result: "Receive Error", durationSec: 0, callType: "Fax" });
    expect(callConnected(fax)).toBe(false); // why the type check has to exist at all
    expect(isFaxCall(fax)).toBe(true);
    expect(opensItem(fax)).toBe(false);
    expect(opensItem({ ...fax, callType: "fax" })).toBe(false);
  });
  it("a Voice call, or a row archived before the type existed, is a phone call", () => {
    expect(opensItem(call(A, TUE_9AM, { callType: "Voice" }))).toBe(true);
    expect(opensItem(call(A, TUE_9AM, { callType: "" }))).toBe(true);
    expect(isFaxCall(text(A, TUE_9AM, { callType: "Fax" }))).toBe(false);
  });
  it("a fax never opens an item in the whole inbox either", () => {
    const fax = call(U, TUE_9AM, { result: "Receive Error", callType: "Fax" });
    expect(buildInbox({ events: [fax], now: TUE_9AM + H })).toEqual([]);
  });
});

/* ── the tick's pages ────────────────────────────────────────────────────── */

describe("dedupeRecords — offset paging repeats a record, and one repeat failed the whole upsert", () => {
  it("keeps one of each id, the LAST read winning (it is the fresher)", () => {
    const out = dedupeRecords([
      { id: 1, messageStatus: "Queued" },
      { id: 2 },
      { id: 1, messageStatus: "Delivered" },
    ]);
    expect(out.map((r) => r.id)).toEqual([2, 1]);
    expect(out.find((r) => r.id === 1).messageStatus).toBe("Delivered");
  });
  it("treats a numeric and a string id as the same record", () => {
    expect(dedupeRecords([{ id: 7 }, { id: "7" }])).toHaveLength(1);
  });
  it("keeps records with no id as they are — the archives' row builders drop those", () => {
    expect(dedupeRecords([{ x: 1 }, { x: 2 }, { id: 3 }])).toHaveLength(3);
  });
  it("is safe on nothing", () => {
    expect(dedupeRecords(undefined)).toEqual([]);
    expect(dedupeRecords([])).toEqual([]);
  });
});

/* ── the weekend clock ───────────────────────────────────────────────────── */

describe("countedWaitMs — Saturday and Sunday, Eastern, don't count", () => {
  it("a weekday afternoon is ordinary wall-clock time", () => {
    expect(countedWaitMs(TUE_9AM, TUE_9AM + 3 * H)).toBe(3 * H);
  });
  it("Friday 6 PM → 15h at 9 AM Monday, and exactly 24h at 6 PM Monday", () => {
    expect(countedWaitMs(FRI_6PM, MON_9AM)).toBe(15 * H);
    expect(countedWaitMs(FRI_6PM, MON_6PM)).toBe(24 * H);
    expect(countedWaitMs(FRI_6PM, MON_6PM) > OVER_AFTER_MS).toBe(false);
    expect(countedWaitMs(FRI_6PM, MON_6PM + MIN) > OVER_AFTER_MS).toBe(true);
  });
  it("a Saturday text reads 0m all weekend, 9h at 9 AM Monday, 24h as Tuesday begins", () => {
    expect(countedWaitMs(SAT_10AM, SUN_5PM)).toBe(0);
    expect(countedWaitMs(SAT_10AM, MON_9AM)).toBe(9 * H);
    expect(countedWaitMs(SAT_10AM, TUE_0AM)).toBe(24 * H);
  });
  it("a fall-back weekend (49 real hours of Sat+Sun) still skips exactly the weekend", () => {
    const fri = at("2026-10-30T22:00:00Z"); // Fri 6 PM EDT
    const mon = at("2026-11-02T14:00:00Z"); // Mon 9 AM EST
    expect(mon - fri).toBe(64 * H); // one extra real hour in the weekend
    expect(countedWaitMs(fri, mon)).toBe(15 * H);
  });
  it("a spring-forward weekend (47 real hours) still skips exactly the weekend", () => {
    const fri = at("2026-03-06T23:00:00Z"); // Fri 6 PM EST
    const mon = at("2026-03-09T13:00:00Z"); // Mon 9 AM EDT
    expect(mon - fri).toBe(62 * H);
    expect(countedWaitMs(fri, mon)).toBe(15 * H);
  });
  it("a whole week counts five days", () => {
    expect(countedWaitMs(MON_9AM, MON_9AM + 7 * 24 * H)).toBe(5 * 24 * H);
  });
  it("finds Eastern midnight on both sides of daylight saving", () => {
    expect(new Date(etMidnightUtc(2026, 9, 21)).toISOString()).toBe("2026-09-21T04:00:00.000Z");
    expect(new Date(etMidnightUtc(2026, 12, 1)).toISOString()).toBe("2026-12-01T05:00:00.000Z");
  });
  it("is zero for a reversed or unreadable pair", () => {
    expect(countedWaitMs(TUE_9AM, TUE_9AM - H)).toBe(0);
    expect(countedWaitMs("nope", TUE_9AM)).toBe(0);
  });
});

/* ── one item's state ────────────────────────────────────────────────────── */

describe("itemState — open, the cover race, reopen, undo", () => {
  it("an inbound text opens the item and its wait runs from it", () => {
    const st = itemState({ events: [text(A, TUE_9AM)], now: TUE_9AM + 2 * H });
    expect(st.open).toBe(true);
    expect(st.waitMs).toBe(2 * H);
    expect(st.openedBy.kind).toBe("text");
    expect(st.over).toBe(false);
  });

  it("a resolution covering the message closes it", () => {
    const t = text(A, TUE_9AM);
    const st = itemState({ events: [t], resolutions: res(A, "texted", TUE_9AM + H, { coversThrough: t.at }), now: TUE_9AM + 2 * H });
    expect(st.open).toBe(false);
    expect(st.lastResolution.how).toBe("texted");
  });

  it("⚠️ a text that lands WHILE the rep types the note stays open — covered by what they SAW, not the clock", () => {
    const seen = text(A, TUE_9AM);
    const late = text(A, TUE_9AM + 10 * MIN, { body: "also, my address changed" });
    // Resolved at +12 min, having seen only the first message.
    const r = res(A, "called", TUE_9AM + 12 * MIN, { coversThrough: seen.at });
    const st = itemState({ events: [seen, late], resolutions: r, now: TUE_9AM + 13 * MIN });
    expect(st.open).toBe(true);
    expect(st.openedBy.at).toBe(late.at);
    expect(st.reopened).toBe(true);
  });

  it("a new inbound after the resolution reopens it, with a fresh clock", () => {
    const r = res(A, "texted", TUE_9AM + H, { coversThrough: TUE_9AM });
    const st = itemState({ events: [text(A, TUE_9AM), text(A, TUE_9AM + 3 * H)], resolutions: r, now: TUE_9AM + 4 * H });
    expect(st.open).toBe(true);
    expect(st.waitMs).toBe(1 * H);
  });

  it("an UNDONE resolution closes nothing", () => {
    const r = res(A, "texted", TUE_9AM + H, { coversThrough: TUE_9AM, undoneAt: TUE_9AM + H + MIN });
    expect(itemState({ events: [text(A, TUE_9AM)], resolutions: r, now: TUE_9AM + 2 * H }).open).toBe(true);
  });

  it("⚠️ Left voicemail is an ATTEMPT — the item stays open and the clock keeps running", () => {
    const r = res(A, "left_vm", TUE_9AM + H, { coversThrough: TUE_9AM + H, note: "" });
    const st = itemState({ events: [text(A, TUE_9AM)], resolutions: r, now: TUE_9AM + 2 * H });
    expect(st.open).toBe(true);
    expect(st.waitMs).toBe(2 * H);
    expect(st.attempts).toHaveLength(1);
    expect(st.attempts[0].by).toBe("katie@medicallymodern.com");
  });

  it("⚠️ nothing before the epoch opens anything — launch day is not every patient who ever texted us", () => {
    const st = itemState({ events: [text(A, TUE_9AM - 24 * H)], now: TUE_9AM, epoch: TUE_9AM - H });
    expect(st.open).toBe(false);
    expect(st.lastInbound).not.toBeNull(); // still history
  });

  it("covers per NUMBER: a patient's alternate number has its own coverage", () => {
    const a = text(A, TUE_9AM);
    const b = text(B, TUE_9AM + 5 * MIN);
    // Resolved having seen A's text only.
    const r = res([A, B], "texted", TUE_9AM + 3 * MIN, { coversThrough: a.at });
    const st = itemState({ events: [a, b], resolutions: r, now: TUE_9AM + H });
    expect(st.open).toBe(true);
    expect(st.openedBy.at).toBe(b.at);
  });

  it("a missed call and the voicemail it left are ONE event, shown as a voicemail", () => {
    const c = call(A, TUE_9AM, { result: "Voicemail" });
    const v = vm(A, TUE_9AM + 40_000, { transcript: "  please call me back  " });
    const st = itemState({ events: [c, v], now: TUE_9AM + H });
    expect(st.previewKind).toBe("voicemail");
    expect(st.preview).toBe("please call me back");
    expect(st.openedBy.kind).toBe("voicemail");
  });

  it("an unjoined missed call reads as a missed call", () => {
    const st = itemState({ events: [call(A, TUE_9AM)], now: TUE_9AM + H });
    expect(st.previewKind).toBe("missed");
    expect(st.preview).toBe("Missed call");
  });

  it("goes Over 24h on counted time", () => {
    const st = itemState({ events: [text(A, FRI_6PM)], now: MON_6PM + MIN });
    expect(st.over).toBe(true);
    const st2 = itemState({ events: [text(A, FRI_6PM)], now: MON_9AM });
    expect(st2.over).toBe(false);
    expect(st2.waitMs).toBe(15 * H);
  });
});

describe("itemState — the suggestion", () => {
  const opened = text(A, TUE_9AM);
  it("a CONNECTED callback after the item opened suggests Called, with who dialed", () => {
    const cb = call(A, TUE_9AM + H, { dir: "out", result: "Call connected", durationSec: 120, dialedBy: "masani@medicallymodern.com" });
    const st = itemState({ events: [opened, cb], now: TUE_9AM + 2 * H });
    expect(st.suggestion).toEqual({ how: "called", at: cb.at, by: "masani@medicallymodern.com" });
  });
  it("⚠️ an UNANSWERED callback suggests nothing — Called asks what you talked about", () => {
    const cb = call(A, TUE_9AM + H, { dir: "out", result: "No Answer" });
    expect(itemState({ events: [opened, cb], now: TUE_9AM + 2 * H }).suggestion).toBeNull();
  });
  it("a text a PERSON sent suggests Texted; an automated one does not", () => {
    const robot = text(A, TUE_9AM + H, { dir: "out", body: "Your reorder form is ready", sentBy: "" });
    expect(itemState({ events: [opened, robot], now: TUE_9AM + 2 * H }).suggestion).toBeNull();
    const human = text(A, TUE_9AM + H, { dir: "out", body: "Ships Friday", sentBy: "katie@medicallymodern.com" });
    expect(itemState({ events: [opened, human], now: TUE_9AM + 2 * H }).suggestion.how).toBe("texted");
  });
  it("⚠️ a text RingCentral gave up on never suggests Texted — the patient never got it", () => {
    const failed = text(A, TUE_9AM + H, {
      dir: "out", sentBy: "katie@medicallymodern.com", status: "SendingFailed", deliveryError: "SMS-RC-410",
    });
    expect(itemState({ events: [opened, failed], now: TUE_9AM + 2 * H }).suggestion).toBeNull();
    // An OLDER text that did go through still qualifies.
    const ok = text(A, TUE_9AM + 30 * MIN, { dir: "out", sentBy: "katie@medicallymodern.com", status: "Delivered" });
    expect(itemState({ events: [opened, ok, failed], now: TUE_9AM + 2 * H }).suggestion.at).toBe(ok.at);
    // ⚠️ An in-flight or unknown status is NOT a failure (§5.5).
    for (const status of ["Queued", "Sent", "", "SomethingNew"]) {
      const t = text(A, TUE_9AM + H, { dir: "out", sentBy: "katie@medicallymodern.com", status });
      expect(itemState({ events: [opened, t], now: TUE_9AM + 2 * H }).suggestion.how, status).toBe("texted");
    }
  });
  it("replies from BEFORE the item opened don't count", () => {
    const old = text(A, TUE_9AM - H, { dir: "out", sentBy: "katie@medicallymodern.com" });
    expect(itemState({ events: [old, opened], now: TUE_9AM + H }).suggestion).toBeNull();
  });
  it("the newest qualifying reply wins", () => {
    const t1 = text(A, TUE_9AM + H, { dir: "out", sentBy: "katie@medicallymodern.com" });
    const c1 = call(A, TUE_9AM + 2 * H, { dir: "out", result: "Accepted", durationSec: 60 });
    const miss = call(A, TUE_9AM + 3 * H, { dir: "out", result: "No Answer" }); // newer, but doesn't qualify
    expect(itemState({ events: [opened, t1, c1, miss], now: TUE_9AM + 4 * H }).suggestion.how).toBe("called");
  });
  it("⚠️ a call a Left voicemail press links to never suggests Called", () => {
    const cb = call(A, TUE_9AM + H, { dir: "out", result: "Call connected", durationSec: 25 });
    const lv = res(A, "left_vm", cb.at + 25_000 + 2 * MIN, { note: "" });
    const st = itemState({ events: [opened, cb], resolutions: lv, now: TUE_9AM + 2 * H });
    expect(st.suggestion).toBeNull();
    expect(st.attempts).toHaveLength(1);
  });
  it("a resolved item suggests nothing", () => {
    const human = text(A, TUE_9AM + H, { dir: "out", sentBy: "katie@medicallymodern.com" });
    const r = res(A, "texted", TUE_9AM + H + MIN, { coversThrough: opened.at });
    expect(itemState({ events: [opened, human], resolutions: r, now: TUE_9AM + 2 * H }).suggestion).toBeNull();
  });
});

/* ── resolving ───────────────────────────────────────────────────────────── */

describe("planResolve — the server enforces what the UI enforces", () => {
  const t = text(A, TUE_9AM);
  const state = () => itemState({ events: [t], now: TUE_9AM + H });
  it("rejects an unknown way of resolving", () => {
    expect(planResolve({ how: "ignored", state: state(), seenThrough: t.at, now: TUE_9AM + H }).status).toBe(400);
  });
  it("⚠️ Called without a note is a 400", () => {
    const r = planResolve({ how: "called", note: "   ", state: state(), seenThrough: t.at, now: TUE_9AM + H });
    expect(r.status).toBe(400);
  });
  it("needs to know what the rep saw", () => {
    expect(planResolve({ how: "texted", state: state(), now: TUE_9AM + H }).status).toBe(400);
  });
  it("covers what was seen, never beyond now", () => {
    const r = planResolve({ how: "texted", state: state(), seenThrough: TUE_9AM + 99 * H, now: TUE_9AM + H });
    expect(r.ok).toBe(true);
    expect(r.coversThrough).toBe(TUE_9AM + H);
  });
  it("⚠️ 409 when somebody else already resolved it, naming who", () => {
    const r1 = res(A, "texted", TUE_9AM + 30 * MIN, { coversThrough: t.at, resolvedBy: "masheke@medicallymodern.com" });
    const st = itemState({ events: [t], resolutions: r1, now: TUE_9AM + H });
    const r = planResolve({ how: "no_action", state: st, seenThrough: t.at, now: TUE_9AM + H });
    expect(r.status).toBe(409);
    expect(r.conflict.by).toBe("masheke@medicallymodern.com");
  });
  it("⚠️ 409 when a new message landed after the other resolution — the stale click would cover nothing", () => {
    const t2 = text(A, TUE_9AM + 40 * MIN);
    const r1 = res(A, "texted", TUE_9AM + 30 * MIN, { coversThrough: t.at });
    const st = itemState({ events: [t, t2], resolutions: r1, now: TUE_9AM + H });
    expect(st.open).toBe(true);
    const r = planResolve({ how: "no_action", state: st, seenThrough: t.at, now: TUE_9AM + H });
    expect(r.status).toBe(409);
  });
  it("Left voicemail needs an open item and carries no note", () => {
    const r = planResolve({ how: "left_vm", note: "ignored", state: state(), now: TUE_9AM + H });
    expect(r).toMatchObject({ ok: true, note: null });
  });
  it("makes notes single-line and capped", () => {
    expect(normalizeNote("  told her\n\nFriday  ")).toBe("told her Friday");
    expect(normalizeNote("x".repeat(NOTE_MAX + 50))).toHaveLength(NOTE_MAX);
  });
});

describe("canUndo / canAddNote / mirrorPending — the Monday copy outbox", () => {
  const me = "katie@medicallymodern.com";
  const rows = (over = {}) => res([A, B], "texted", TUE_9AM, { note: "", ...over });
  it("only the author, inside 15 minutes", () => {
    expect(canUndo({ rows: rows(), actor: me, now: TUE_9AM + MIN }).ok).toBe(true);
    expect(canUndo({ rows: rows(), actor: "josh@medicallymodern.com", now: TUE_9AM + MIN }).status).toBe(403);
    expect(canUndo({ rows: rows(), actor: me, now: TUE_9AM + UNDO_WINDOW_MS + 1 }).status).toBe(409);
  });
  it("⚠️ never once the note is on Monday — or might be", () => {
    expect(canUndo({ rows: rows({ mirroredTo: "18407459988:1001" }), actor: me, now: TUE_9AM + MIN }).status).toBe(409);
    expect(canUndo({ rows: rows({ mirrorClaimedAt: TUE_9AM + MIN }), actor: me, now: TUE_9AM + 2 * MIN }).status).toBe(409);
  });
  it("adds the optional note once, to Texted / No action needed, before the copy", () => {
    expect(canAddNote({ rows: rows(), actor: me, now: TUE_9AM + MIN, note: "left it there" }).ok).toBe(true);
    expect(canAddNote({ rows: rows({ note: "already" }), actor: me, now: TUE_9AM + MIN, note: "x" }).status).toBe(409);
    expect(canAddNote({ rows: res(A, "called", TUE_9AM), actor: me, now: TUE_9AM + MIN, note: "x" }).status).toBe(400);
    expect(canAddNote({ rows: rows(), actor: me, now: TUE_9AM + MIN, note: "  " }).status).toBe(400);
  });
  it("a note waits to be copied by its author's browser only", () => {
    const [r] = res(A, "called", TUE_9AM);
    expect(mirrorPending(r, me, TUE_9AM + MIN)).toBe(true);
    expect(mirrorPending(r, "josh@medicallymodern.com", TUE_9AM + MIN)).toBe(false);
  });
  it("nothing to copy: no note, no patient, undone, done, or out of tries", () => {
    expect(mirrorPending(res(A, "no_action", TUE_9AM, { note: "" })[0], me)).toBe(false);
    expect(mirrorPending(res(A, "called", TUE_9AM, { itemId: "" })[0], me)).toBe(false);
    expect(mirrorPending(res(A, "called", TUE_9AM, { undoneAt: TUE_9AM + MIN })[0], me)).toBe(false);
    expect(mirrorPending(res(A, "called", TUE_9AM, { mirroredTo: "x" })[0], me)).toBe(false);
    expect(mirrorPending(res(A, "called", TUE_9AM, { mirrorAttempts: MAX_MIRROR_ATTEMPTS })[0], me)).toBe(false);
  });
  it("⚠️ a claim that never reported back is released after 10 minutes", () => {
    const [r] = res(A, "called", TUE_9AM, { mirrorClaimedAt: TUE_9AM });
    expect(mirrorPending(r, me, TUE_9AM + STALE_CLAIM_MS - 1)).toBe(false);
    expect(mirrorPending(r, me, TUE_9AM + STALE_CLAIM_MS + 1)).toBe(true);
  });
});

/* ── grouping ────────────────────────────────────────────────────────────── */

describe("resolveTarget — links, then the directory, then the live lookup", () => {
  const dirRow = { boardId: 18407459988, itemId: "2001", name: "Jane Doe", groupId: "topics" };
  it("the directory names a known number", () => {
    const t = resolveTarget(A, { links: new Map(), directory: new Map([[A, dirRow]]), cache: new Map() });
    expect(t).toMatchObject({ itemId: "2001", via: "directory" });
  });
  it("a live-lookup hit covers a patient the directory hasn't seen yet", () => {
    const t = resolveTarget(U, { links: new Map(), directory: new Map(), cache: new Map([[U, { ...dirRow, itemId: "3001" }]]) });
    expect(t).toMatchObject({ itemId: "3001", via: "live" });
  });
  it("a cached MISS is unmatched", () => {
    expect(resolveTarget(U, { links: new Map(), directory: new Map(), cache: new Map([[U, { itemId: "" }]]) })).toBeNull();
  });
  it("⚠️ a link FOLLOWS the patient to their current board", () => {
    const link = { anchorHmac: A, boardId: 18410804557, itemId: "999", name: "Jane Doe" }; // made on Welcome Call
    const t = resolveTarget(U, { links: new Map([[U, link]]), directory: new Map([[A, dirRow]]), cache: new Map() });
    expect(t).toMatchObject({ itemId: "2001", via: "link" }); // now Subscription
  });
  it("⚠️ …but not onto a DIFFERENT person who shares the anchor number (a household)", () => {
    const link = { anchorHmac: A, boardId: 18410804557, itemId: "999", name: "John Doe" };
    const t = resolveTarget(U, { links: new Map([[U, link]]), directory: new Map([[A, dirRow]]), cache: new Map() });
    expect(t).toMatchObject({ itemId: "999", via: "link" });
  });
  it("a link wins over the directory's own pick for that number", () => {
    const link = { anchorHmac: "", boardId: 18410804557, itemId: "777", name: "Sue Doe" };
    const t = resolveTarget(A, { links: new Map([[A, link]]), directory: new Map([[A, dirRow]]), cache: new Map() });
    expect(t.itemId).toBe("777");
  });
});

describe("keys and pills", () => {
  it("round-trips keys, and rejects anything else", () => {
    expect(parseKey(groupKeyFor(A, { boardId: 18407459988, itemId: "2001" }))).toEqual({ type: "p", boardId: 18407459988, itemId: "2001" });
    expect(parseKey(groupKeyFor(A, null))).toEqual({ type: "n", hmac: A });
    expect(parseKey("n:5555550101")).toBeNull(); // never a number
    expect(parseKey("p:1:x; DROP")).toBeNull();
  });
  it("names the stage the way the patient screen does", () => {
    expect(stagePill(null)).toBe("Unmatched");
    expect(stagePill({ boardId: 18406352652, itemId: "1" })).toBe("Intake");
    expect(stagePill({ boardId: 18406060017, itemId: "1" })).toBe("Medical Necessity");
    expect(stagePill({ boardId: 18410601299, itemId: "1" })).toBe("Insurance");
    expect(stagePill({ boardId: 18410804557, itemId: "1" })).toBe("Welcome Call");
    expect(stagePill({ boardId: 18407459988, itemId: "1", groupId: "topics" })).toBe("Subscription");
    expect(stagePill({ boardId: 18407459988, itemId: "1", groupId: "group_mkp19fyp" })).toBe("Inactive");
  });
});

/* ── the list ────────────────────────────────────────────────────────────── */

describe("buildInbox + filterInbox", () => {
  const targets = new Map([
    [A, { boardId: 18407459988, itemId: "2001", name: "Jane Doe", groupId: "topics" }],
    [B, { boardId: 18407459988, itemId: "2001", name: "Jane Doe", groupId: "topics" }],
  ]);
  const now = TUE_9AM + 30 * H;

  it("⚠️ folds a patient's primary and alternate into ONE item", () => {
    const items = buildInbox({ events: [text(A, TUE_9AM), text(B, TUE_9AM + H)], targets, now });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "p:18407459988:2001", name: "Jane Doe", stage: "Subscription", open: true });
    expect(items[0].numbers.map((n) => n.last4).sort()).toEqual(["0101", "0202"]);
  });

  it("an unmatched number is its own item", () => {
    const items = buildInbox({ events: [text(A, TUE_9AM), text(U, TUE_9AM)], targets, now });
    expect(items.map((i) => i.key).sort()).toEqual([`n:${U}`, "p:18407459988:2001"]);
    expect(items.find((i) => i.key === `n:${U}`)).toMatchObject({ name: "", stage: "Unmatched" });
  });

  it("outbound-only traffic (a reorder text nobody answered) is not a conversation to handle", () => {
    expect(buildInbox({ events: [text(A, TUE_9AM, { dir: "out" })], targets, now })).toHaveLength(0);
  });

  it("the All view reaches back 30 days; an OPEN item is listed however old", () => {
    const oldOpen = text(A, now - DISPLAY_WINDOW_MS - 24 * H);
    const oldClosed = text(U, now - DISPLAY_WINDOW_MS - 24 * H);
    const r = res(U, "texted", oldClosed.at + H, { coversThrough: oldClosed.at, itemId: "" });
    const items = buildInbox({ events: [oldOpen, oldClosed], resolutions: r, targets, now });
    expect(items.map((i) => i.key)).toEqual(["p:18407459988:2001"]);
  });

  it("views, counts, the sticky row, type chips and sort", () => {
    const events = [
      text(A, TUE_9AM), // Jane — open, 30h → over
      call(U, TUE_9AM + 20 * H), // unknown — missed, open, 10h
      text("d".repeat(64), TUE_9AM + 25 * H), // another unknown — open, 5h
    ];
    const done = text("e".repeat(64), TUE_9AM + 26 * H);
    const r = res("e".repeat(64), "texted", TUE_9AM + 27 * H, { coversThrough: done.at, itemId: "" });
    const items = buildInbox({ events: [...events, done], resolutions: r, targets, now });

    const open = filterInbox(items, { view: "open" });
    expect(open.counts).toEqual({ open: 3, over: 1 });
    expect(open.rows.map((i) => i.waitMs)).toEqual([30 * H, 10 * H, 5 * H]); // longest waiting first

    expect(filterInbox(items, { view: "over" }).rows).toHaveLength(1);
    expect(filterInbox(items, { view: "all" }).rows).toHaveLength(4);

    // The row just resolved keeps its place until the rep opens another item.
    const sticky = `n:${"e".repeat(64)}`;
    const withSticky = filterInbox(items, { view: "open", sticky });
    expect(withSticky.rows.map((i) => i.key)).toContain(sticky);

    expect(filterInbox(items, { view: "open", type: "missed" }).rows.map((i) => i.key)).toEqual([`n:${U}`]);
    expect(filterInbox(items, { view: "all", sort: "recent" }).rows[0].key).toBe(sticky);
    expect(badgeCounts(items)).toEqual({ open: 3, over: 1 });
  });

  it("⚠️ the row just resolved keeps its PLACE in Longest waiting, not just its presence", () => {
    // Waiting since 11 PM Tuesday; resolved at noon Wednesday. Its sticky wait
    // runs to NOW like every open row's, so it sits between the 30h and the 10h
    // rows rather than dropping to the bottom as the rep's eye leaves it.
    const events = [text(A, TUE_9AM), call(U, TUE_9AM + 20 * H), text("d".repeat(64), TUE_9AM + 25 * H)];
    const done = text("e".repeat(64), TUE_9AM + 14 * H);
    const r = res("e".repeat(64), "texted", TUE_9AM + 27 * H, { coversThrough: done.at, itemId: "" });
    const items = buildInbox({ events: [...events, done], resolutions: r, targets, now });
    const sticky = `n:${"e".repeat(64)}`;
    const keys = filterInbox(items, { view: "open", sticky }).rows.map((i) => i.key);
    expect(keys).toEqual(["p:18407459988:2001", sticky, `n:${U}`, `n:${"d".repeat(64)}`]);
    // Once the rep opens something else, it goes.
    expect(filterInbox(items, { view: "open" }).rows.map((i) => i.key)).not.toContain(sticky);
  });

  it("search: a name, a last-four hint, or a whole number by its hash only", () => {
    const items = buildInbox({ events: [text(A, TUE_9AM), text(U, TUE_9AM)], targets, now });
    expect(filterInbox(items, { q: "jane" }).rows).toHaveLength(1);
    expect(filterInbox(items, { q: "unknown" }).rows.map((i) => i.key)).toEqual([`n:${U}`]);
    expect(filterInbox(items, { q: "0303" }).rows.map((i) => i.key)).toEqual([`n:${U}`]);
    expect(filterInbox(items, { q: "(555) 555-0303", qHmac: U }).rows.map((i) => i.key)).toEqual([`n:${U}`]);
    // ⚠️ A whole number that hashes to nobody finds nobody — never a last-four
    // lookalike, which would be somebody else.
    expect(filterInbox(items, { q: "(555) 555-0303", qHmac: "f".repeat(64) }).rows).toHaveLength(0);
    // The tab counts are taken before the search.
    expect(filterInbox(items, { q: "jane" }).counts.open).toBe(2);
  });
});

/* ── Left voicemail and the call it was left on ─────────────────────────── */

describe("leftVmCallFor", () => {
  const press = TUE_9AM + H;
  const out = (startOffset, durSec, over = {}) =>
    call(A, press + startOffset, { dir: "out", result: "Call connected", durationSec: durSec, ...over });
  it("links the newest outbound call that ENDED within 15 minutes of the press", () => {
    const older = out(-20 * MIN, 30);
    const newer = out(-3 * MIN, 40);
    expect(leftVmCallFor({ resolvedAt: press }, [older, newer]).id).toBe(newer.id);
  });
  it("⚠️ fails closed: no call in the window, no Listen", () => {
    expect(leftVmCallFor({ resolvedAt: press }, [out(-LEFT_VM_LINK_MS - 5 * MIN, 30)])).toBeNull();
    expect(leftVmCallFor({ resolvedAt: press }, [call(A, press - MIN, { dir: "in" })])).toBeNull();
    expect(leftVmCallFor({ resolvedAt: press }, [])).toBeNull();
  });
  it("tolerates a minute of clock skew, and no more", () => {
    expect(leftVmCallFor({ resolvedAt: press }, [out(20_000, 30)])).not.toBeNull(); // ends 50s "after" the press
    expect(leftVmCallFor({ resolvedAt: press }, [out(5 * MIN, 30)])).toBeNull();
  });
});

describe("dialerFor", () => {
  it("attributes an outbound call to the nearest Call press on that number", () => {
    const c = call(A, TUE_9AM, { dir: "out", result: "Accepted", durationSec: 60 });
    const dials = [
      { hmac: A, by: "katie@medicallymodern.com", at: TUE_9AM - 5 * 1000 },
      { hmac: A, by: "josh@medicallymodern.com", at: TUE_9AM - 90 * 1000 },
      { hmac: B, by: "sam@medicallymodern.com", at: TUE_9AM },
    ];
    expect(dialerFor(c, dials)).toBe("katie@medicallymodern.com");
  });
  it("a call dialed from the RingCentral app stays unattributed", () => {
    expect(dialerFor(call(A, TUE_9AM, { dir: "out" }), [{ hmac: A, by: "x", at: TUE_9AM - 10 * MIN }])).toBe("");
  });
});

/* ── the timeline ────────────────────────────────────────────────────────── */

describe("buildTimeline", () => {
  it("one list: texts, calls with their voicemail, attempts and dividers — undone hidden", () => {
    const t = text(A, TUE_9AM);
    const c = call(A, TUE_9AM + H, { result: "Voicemail" });
    const v = vm(A, TUE_9AM + H + 45_000);
    const lone = vm(B, TUE_9AM + 5 * H);
    const cb = call(A, TUE_9AM + 2 * H, { dir: "out", result: "Call connected", durationSec: 20 });
    const lv = res(A, "left_vm", cb.at + 20_000 + MIN, { note: "" });
    const good = res([A, B], "called", TUE_9AM + 3 * H, { coversThrough: v.at });
    const undone = res(A, "no_action", TUE_9AM + 4 * H, { undoneAt: TUE_9AM + 4 * H + MIN });
    const tl = buildTimeline({ events: [lone, cb, v, c, t], resolutions: [...lv, ...good, ...undone] });
    expect(tl.map((e) => e.type)).toEqual(["text", "call", "call", "attempt", "resolution", "voicemail"]);
    const missed = tl[1];
    expect(missed).toMatchObject({ missed: true, voicemail: { id: v.id } });
    expect(tl[3]).toMatchObject({ how: "left_vm", linkedCallId: cb.id });
    expect(tl[4]).toMatchObject({ how: "called", label: "Called", note: "Told her Friday" });
    expect(tl.filter((e) => e.type === "resolution")).toHaveLength(1); // one click → one divider
  });
});

/* ── the SLA card ────────────────────────────────────────────────────────── */

describe("slaReport", () => {
  it("counts time from the period's first message to the resolution, on the weekday clock", () => {
    const e1 = text(A, FRI_6PM);
    const e2 = text(U, TUE_9AM);
    const r1 = res(A, "called", MON_9AM, { coversThrough: e1.at }); // 15 counted hours
    const r2 = res(U, "texted", TUE_9AM + 30 * H, { coversThrough: e2.at, resolvedBy: "masheke@medicallymodern.com", itemId: "" }); // 30h — a breach
    const lv = res(U, "left_vm", TUE_9AM + 2 * H, { note: "", resolvedBy: "masheke@medicallymodern.com" });
    const rep = slaReport({ resolutions: [...r1, ...r2, ...lv], events: [e1, e2], since: 0, now: TUE_9AM + 40 * H, open: 2, over: 1 });
    expect(rep.resolved).toBe(2);
    expect(rep.within).toBe(1);
    expect(rep.withinPct).toBe(50);
    expect(rep.medianMs).toBe(Math.round((15 * H + 30 * H) / 2));
    expect(rep.byHow).toEqual({ called: 1, texted: 1 });
    expect(rep.attempts).toBe(1); // ⚠️ an attempt, never a resolution
    const m = rep.reps.find((r) => r.who === "masheke@medicallymodern.com");
    expect(m).toMatchObject({ resolved: 1, within: 0, attempts: 1, hows: ["texted"] });
    expect(rep).toMatchObject({ open: 2, over: 1 });
  });
  it("a second resolution of the same number measures from its OWN period", () => {
    const e1 = text(A, TUE_9AM);
    const e2 = text(A, TUE_9AM + 10 * H);
    const r1 = res(A, "texted", TUE_9AM + H, { coversThrough: e1.at });
    const r2 = res(A, "texted", TUE_9AM + 12 * H, { coversThrough: e2.at });
    const rep = slaReport({ resolutions: [...r1, ...r2], events: [e1, e2], since: 0, now: TUE_9AM + 13 * H });
    expect(rep.medianMs).toBe(Math.round((1 * H + 2 * H) / 2));
  });
  it("undone resolutions and outside-the-window ones don't count", () => {
    const e1 = text(A, TUE_9AM);
    const r1 = res(A, "texted", TUE_9AM + H, { coversThrough: e1.at, undoneAt: TUE_9AM + H + MIN });
    expect(slaReport({ resolutions: r1, events: [e1], since: 0 }).resolved).toBe(0);
    const r2 = res(A, "texted", TUE_9AM + H, { coversThrough: e1.at });
    expect(slaReport({ resolutions: r2, events: [e1], since: TUE_9AM + 2 * H }).resolved).toBe(0);
  });
});

/* ── shadow measurement ─────────────────────────────────────────────────── */

describe("shadowReport + isReplyToAutomation", () => {
  it("counts what the inbox would have opened, per Eastern day, by kind", () => {
    const robot = text(A, TUE_9AM - H, { dir: "out", body: "Reorder form", sentBy: "" });
    const reply = text(A, TUE_9AM, { body: "Got it, thank you!" });
    const c = call(U, TUE_9AM + H, { result: "Voicemail" });
    const v = vm(U, TUE_9AM + H + 30_000);
    const rep = shadowReport({ events: [robot, reply, c, v], targets: new Map([[A, { itemId: "1" }]]), since: 0 });
    expect(rep.events).toBe(2); // the missed call and its voicemail are one
    expect(rep.perDay).toEqual([{ day: "2026-09-22", text: 1, missed: 0, voicemail: 1, total: 2 }]);
    expect(rep.unmatchedEvents).toBe(1);
    expect(rep.repliesToAutomation).toBe(1);
  });
  it("a reply to a PERSON is not a reply to automation", () => {
    const human = text(A, TUE_9AM - H, { dir: "out", sentBy: "katie@medicallymodern.com" });
    expect(isReplyToAutomation(text(A, TUE_9AM), [human])).toBe(false);
  });
});

/* ── health ─────────────────────────────────────────────────────────────── */

describe("inboxHealth", () => {
  const now = TUE_9AM;
  it("⚠️ is NOT ok when no tick has ever completed", () => {
    expect(inboxHealth({ now })).toMatchObject({ ok: false, reason: "no complete capture tick recorded yet" });
  });
  it("is not ok after ten minutes without a complete tick", () => {
    expect(inboxHealth({ lastCompleteAt: now - 11 * MIN, now }).ok).toBe(false);
    expect(inboxHealth({ lastCompleteAt: now - 2 * MIN, now }).ok).toBe(true);
  });
  it("is not ok when the last tick hit its page ceiling", () => {
    expect(inboxHealth({ lastCompleteAt: now - MIN, lastTruncated: true, now }).ok).toBe(false);
  });
  it("REPORTS old uncopied notes without failing — the note is safe in the log", () => {
    const h = inboxHealth({ lastCompleteAt: now - MIN, pendingMirrors: 2, oldestPendingMirrorAt: now - 30 * H, failedMirrors: 1, now });
    expect(h.ok).toBe(true);
    expect(h.warnings).toHaveLength(2);
    expect(h.oldestPendingMirrorHours).toBe(30);
  });
  // ⚠️ Switched off is a deliberate act; paging every ten minutes about it is
  // the noise that teaches everybody to swipe alerts away (2026-09-23 review).
  // It is still SAID, because a blind inbox reads exactly like a quiet day.
  it("⚠️ SAYS an archive the tick feeds is switched off — as a warning, never a page", () => {
    const h = inboxHealth({ lastCompleteAt: now - MIN, feedsOff: ["texts"], now });
    expect(h.ok).toBe(true);
    expect(h.feedsOff).toEqual(["texts"]);
    expect(h.reason).toBeNull();
    expect(h.warnings.join(" ")).toMatch(/texts are not reaching the inbox/);
  });
});

/* ── row mappers ─────────────────────────────────────────────────────────── */

describe("row mappers", () => {
  it("read the archives' own columns", () => {
    expect(
      textEvent({ rc_message_id: 7, direction: "Outbound", created_at: "2026-09-22T13:00:00Z", phone_hmac: A, last4: "0101", body: "hi", attachments: null }, "k@x"),
    ).toMatchObject({ kind: "text", id: "7", dir: "out", at: TUE_9AM, sentBy: "k@x", attachments: [] });
    expect(
      callEvent({ rc_call_id: "c1", direction: "Inbound", started_at: new Date(TUE_9AM), phone_hmac: A, result: "Missed", leg_results: ["Missed"], duration_sec: 0 }),
    ).toMatchObject({ kind: "call", dir: "in", at: TUE_9AM, legResults: ["Missed"], callType: "" });
    expect(callEvent({ rc_call_id: "c2", direction: "Inbound", started_at: TUE_9AM, call_type: "Fax" }).callType).toBe("Fax");
    expect(voicemailEvent({ rc_message_id: "v1", direction: "Inbound", created_at: TUE_9AM, phone_hmac: A, transcript: null })).toMatchObject({
      kind: "voicemail",
      transcript: "",
    });
    expect(
      resolutionFromRow({ id: 1, resolution_id: "u", phone_hmac: A, how: "called", covers_through: "2026-09-22T13:00:00Z", resolved_at: "2026-09-22T14:00:00Z", item_board: "18407459988" }),
    ).toMatchObject({ coversThrough: TUE_9AM, resolvedAt: TUE_9AM + H, itemBoard: 18407459988, undoneAt: null });
  });
});

describe("noteTargetFor — where a resolve note is copied (2026-09-23 review)", () => {
  const own = { boardId: 18410804557, itemId: "101", name: "Ada Sample" };

  it("defaults to the item's own patient", () => {
    expect(noteTargetFor(own, undefined)).toEqual({ boardId: 18410804557, itemId: "101" });
    expect(noteTargetFor(own, null)).toEqual({ boardId: 18410804557, itemId: "101" });
  });

  it("⚠️ a shared line: the patient the rep was LOOKING AT gets the note", () => {
    expect(noteTargetFor(own, { boardId: 18407459988, itemId: "202" })).toEqual({ boardId: 18407459988, itemId: "202" });
    // Numbers arriving as strings are fine; the shape is what is checked.
    expect(noteTargetFor(own, { boardId: "18407459988", itemId: 202 })).toEqual({ boardId: 18407459988, itemId: "202" });
  });

  it("⚠️⚠️ an UNMATCHED item never copies, whatever the browser names", () => {
    expect(noteTargetFor(null, { boardId: 18407459988, itemId: "202" })).toBeNull();
    expect(noteTargetFor({ boardId: null, itemId: "" }, { boardId: 18407459988, itemId: "202" })).toBeNull();
  });

  it("a malformed request falls back to the item's own patient, never to nothing", () => {
    for (const bad of [
      { boardId: "", itemId: "202" },
      { boardId: 18407459988, itemId: "" },
      { boardId: "0", itemId: "202" },
      { boardId: "18407459988; DROP", itemId: "202" },
      { boardId: 18407459988, itemId: "abc" },
      { boardId: 18407459988, itemId: "-5" },
      "18407459988:202",
    ]) {
      expect(noteTargetFor(own, bad), JSON.stringify(bad)).toEqual({ boardId: 18410804557, itemId: "101" });
    }
  });
});
