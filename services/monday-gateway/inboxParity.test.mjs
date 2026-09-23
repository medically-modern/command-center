/**
 * The inbox's two hand-synced mirrors, run against the SPA's REAL rules.
 *
 * `commsInboxRules.mjs` carries copies of two SPA rules, because the gateway is
 * a separate Node service that cannot import the SPA's TypeScript at runtime:
 *
 *   · the missed-call verdict — src/lib/callHistory/callHistory.ts
 *     (`callConnected` / `isVoicemail`, the "read the legs" rule of §5.13/§5.16);
 *   · the call → voicemail join — src/lib/commsHub/callVoicemail.ts
 *     (`voicemailForCall`, §5.28).
 *
 * That is the CLAUDE.md §5.7 hazard, and here it fails silently in the worst
 * direction: a drifted verdict opens inbox items for calls a rep TOOK, or reads
 * a real missed call as answered and opens nothing. So this suite imports both
 * copies and runs them over the same records.
 *
 * ⚠️ The gateway copy is fed EXACTLY what `call_archive` stores — each record
 * goes through `callArchiveRules.toCallRow` first. That is also the proof the
 * plan asked for (COMMS_INBOX_PLAN.md §4.2): `result`, `leg_results` and
 * `duration_sec` are everything the rule reads. If the SPA rule ever starts
 * reading another field, the stored row cannot carry it and this fails.
 */
import { describe, it, expect } from "vitest";
import { callConnected as spaConnected, isVoicemail as spaIsVoicemail } from "../../src/lib/callHistory/callHistory.ts";
import { voicemailForCall as spaVoicemailForCall } from "../../src/lib/commsHub/callVoicemail.ts";
import { toCallRow } from "./callArchiveRules.mjs";
import {
  callConnected,
  callWentToVoicemail,
  voicemailForCall,
  VOICEMAIL_AFTER_CALL_MS,
  VOICEMAIL_BEFORE_CALL_MS,
} from "./commsInboxRules.mjs";

/** Every result label either copy names, in the spellings RingCentral sends
 *  and a few it might, plus labels neither copy knows. */
const RESULTS = [
  "Accepted", "Call connected", "Connected", "Answered", "OK",
  "Voicemail", "Message Left",
  "Missed", "No Answer", "Busy", "Rejected", "Declined", "Hang Up", "Abandoned",
  "Stopped", "Blocked", "Call Failed", "Answered Not Accepted", "Unknown Caller",
  " ACCEPTED ", "missed", "voicemail",
  "Receive Error", "International Disabled", "Something New", "", undefined,
];
const LEG_SETS = [
  [],
  [{ result: "Accepted" }],
  [{ result: "Missed" }, { result: "Accepted" }],
  [{ result: "Voicemail" }],
  [{ result: "Missed" }, { result: "" }],
  [{ result: "Call connected" }, { result: "Voicemail" }],
  [{}],
];
const DURATIONS = [0, 1, 18, 240, undefined];

function records() {
  const out = [];
  let id = 0;
  for (const result of RESULTS) {
    for (const legs of LEG_SETS) {
      for (const duration of DURATIONS) {
        out.push({
          id: String(++id),
          startTime: "2026-09-22T13:00:00.000Z",
          direction: id % 2 ? "Inbound" : "Outbound",
          from: { phoneNumber: "+15555550101" },
          to: { phoneNumber: "+13475037148" },
          ...(result === undefined ? {} : { result }),
          ...(duration === undefined ? {} : { duration }),
          legs,
        });
      }
    }
  }
  return out;
}

describe("the missed-call verdict — gateway mirror vs the SPA's callHistory.ts", () => {
  const recs = records();

  it(`agrees on every one of ${RESULTS.length * LEG_SETS.length * DURATIONS.length} records, read through what call_archive stores`, () => {
    const disagreements = [];
    for (const rec of recs) {
      const row = toCallRow(rec);
      const mine = callConnected({ result: row.result, legResults: row.legResults, durationSec: row.durationSec });
      const theirs = spaConnected(rec);
      if (mine !== theirs) disagreements.push({ result: rec.result, legs: rec.legs, duration: rec.duration, mine, theirs });
    }
    expect(disagreements).toEqual([]);
  });

  it("agrees on whether it reached voicemail", () => {
    const disagreements = [];
    for (const rec of recs) {
      const row = toCallRow(rec);
      const mine = callWentToVoicemail({ result: row.result, legResults: row.legResults });
      if (mine !== spaIsVoicemail(rec)) disagreements.push({ result: rec.result, legs: rec.legs });
    }
    expect(disagreements).toEqual([]);
  });
});

describe("the call → voicemail join — gateway mirror vs the SPA's callVoicemail.ts", () => {
  const CALL_AT = new Date("2026-09-15T14:30:00.000Z").getTime();
  const iso = (ms) => new Date(ms).toISOString();
  const numbers = ["+15555550101", "+15555550102"];
  const last10 = (n) => n.replace(/\D/g, "").slice(-10);

  // Offsets straddling both edges of the window, and a few in the middle.
  // ⚠️ Including one millisecond either side of each edge: an off-by-one in the
  // mirror is exactly the drift that would otherwise pass.
  const OFFSETS = [
    -VOICEMAIL_BEFORE_CALL_MS - 1000,
    -VOICEMAIL_BEFORE_CALL_MS - 1,
    -VOICEMAIL_BEFORE_CALL_MS,
    -30_000,
    0,
    45_000,
    95_000,
    6 * 60_000,
    VOICEMAIL_AFTER_CALL_MS,
    VOICEMAIL_AFTER_CALL_MS + 1,
    VOICEMAIL_AFTER_CALL_MS + 1000,
  ];

  /** Every pair and triple of voicemails from the offsets, on either number. */
  function scenarios() {
    const out = [];
    let id = 0;
    for (let i = 0; i < OFFSETS.length; i++) {
      for (let j = i; j < OFFSETS.length; j++) {
        for (const n1 of numbers) {
          for (const n2 of numbers) {
            const list = [
              { id: ++id, fromNumber: n1, creationTime: iso(CALL_AT + OFFSETS[i]) },
              { id: ++id, fromNumber: n2, creationTime: iso(CALL_AT + OFFSETS[j]) },
            ];
            // The SPA's list is newest first; the gateway sorts to the same.
            list.sort((a, b) => new Date(b.creationTime) - new Date(a.creationTime));
            out.push(list);
          }
        }
      }
    }
    return out;
  }

  it("picks the same message in every scenario — or none in both", () => {
    const disagreements = [];
    for (const list of scenarios()) {
      for (const voicemail of [true, false]) {
        const spaCall = { phone: numbers[0], at: iso(CALL_AT), voicemail };
        const theirs = spaVoicemailForCall(spaCall, list);
        const mine = voicemailForCall(
          { key: last10(spaCall.phone), at: CALL_AT, voicemail },
          list.map((v) => ({ id: v.id, key: last10(v.fromNumber), at: v.creationTime })),
        );
        if ((theirs?.id ?? null) !== (mine?.id ?? null)) {
          disagreements.push({ voicemail, list, theirs: theirs?.id ?? null, mine: mine?.id ?? null });
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("uses the same window as the SPA", async () => {
    const spa = await import("../../src/lib/commsHub/callVoicemail.ts");
    expect(VOICEMAIL_AFTER_CALL_MS).toBe(spa.VOICEMAIL_AFTER_CALL_MS);
    expect(VOICEMAIL_BEFORE_CALL_MS).toBe(spa.VOICEMAIL_BEFORE_CALL_MS);
  });
});
