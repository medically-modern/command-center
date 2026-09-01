import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Same shape as listColumns.test.ts: resolve from the repo root, since
 *  import.meta.url is not a file: URL under the jsdom environment. */
const gatewaySrc = (f) => readFileSync(resolve(process.cwd(), "services/monday-gateway", f), "utf8");
import {
  MAX_PAGES,
  PAGE_SIZE,
  STALE_AFTER_MS,
  WINDOW_DAYS,
  archiveHealth,
  counterparty,
  isArchivable,
  last10,
  last4,
  mediaAttachments,
  mergeConversation,
  rowToMessage,
  toArchiveRow,
  windowStart,
} from "./smsArchiveRules.mjs";
import { upsertSql } from "./smsArchive.mjs";

const OURS = ["+13475037148"];
const PATIENT = "+17186331850";

const sms = (over = {}) => ({
  id: 1,
  type: "SMS",
  direction: "Inbound",
  subject: "hello",
  creationTime: "2026-08-15T12:00:00.000Z",
  from: { phoneNumber: PATIENT },
  to: [{ phoneNumber: OURS[0] }],
  ...over,
});

describe("the reconcile window", () => {
  /** Measured against the live account on 2026-09-01: the oldest surviving
   *  record was 2026-08-01 and every earlier dateTo returned 0 rows for EVERY
   *  number. A window shorter than that retention would silently clip the
   *  archive — the one failure this module cannot detect after the fact. */
  it("reads back further than RingCentral actually retains", () => {
    expect(WINDOW_DAYS).toBeGreaterThan(31);
  });

  it("windowStart is that many days before now, as ISO", () => {
    const now = Date.parse("2026-09-01T00:00:00.000Z");
    expect(windowStart(now, 35)).toBe("2026-07-28T00:00:00.000Z");
  });

  it("pages are bounded, with headroom over a full window", () => {
    // ~180 records/day observed × 35 days ÷ 250 per page ≈ 26 pages.
    expect(PAGE_SIZE * MAX_PAGES).toBeGreaterThan(180 * WINDOW_DAYS);
  });
});

describe("isArchivable", () => {
  it("takes SMS and MMS", () => {
    expect(isArchivable({ type: "SMS" })).toBe(true);
    // A patient answering with a photo of their insurance card sends an MMS.
    expect(isArchivable({ type: "MMS" })).toBe(true);
  });

  it("leaves fax and voicemail alone — they share this store", () => {
    expect(isArchivable({ type: "Fax" })).toBe(false);
    expect(isArchivable({ type: "VoiceMail" })).toBe(false);
    expect(isArchivable({})).toBe(false);
    expect(isArchivable(null)).toBe(false);
  });
});

describe("counterparty — the archive is keyed by the PATIENT", () => {
  it("inbound: the sender", () => {
    expect(counterparty(sms(), OURS)).toBe(PATIENT);
  });

  it("outbound: the recipient, not our own line", () => {
    const r = sms({ direction: "Outbound", from: { phoneNumber: OURS[0] }, to: [{ phoneNumber: PATIENT }] });
    expect(counterparty(r, OURS)).toBe(PATIENT);
  });

  /** Storing our own number as the counterparty would create a fake thread that
   *  every lookup of our own line then matches. */
  it("a self-test text has no patient side", () => {
    const r = sms({ direction: "Outbound", from: { phoneNumber: OURS[0] }, to: [{ phoneNumber: OURS[0] }] });
    expect(counterparty(r, OURS)).toBe("");
  });

  it("falls back to the known-numbers filter when direction is missing", () => {
    const r = { from: { phoneNumber: OURS[0] }, to: [{ phoneNumber: PATIENT }] };
    expect(counterparty(r, OURS)).toBe(PATIENT);
  });

  it("matches our line however it was formatted", () => {
    const r = sms({ direction: "Outbound", from: { phoneNumber: "(347) 503-7148" }, to: [{ phoneNumber: PATIENT }] });
    expect(counterparty(r, OURS)).toBe(PATIENT);
  });

  it("returns nothing when there are no parties at all", () => {
    expect(counterparty({ type: "SMS", direction: "Inbound" }, OURS)).toBe("");
  });
});

describe("mediaAttachments", () => {
  it("keeps media and drops the text part, which is already the body", () => {
    const r = sms({
      attachments: [
        { id: "1", type: "Text", contentType: "text/plain", uri: "u1" },
        { id: "2", type: "MmsAttachment", contentType: "image/jpeg", uri: "u2" },
        { id: "3", type: "MmsAttachment", contentType: "text/plain", uri: "u3" },
        { id: "4", type: "MmsAttachment", contentType: "image/png" }, // no uri
      ],
    });
    expect(mediaAttachments(r)).toEqual([{ id: "2", contentType: "image/jpeg", uri: "u2" }]);
  });

  it("is empty, never undefined, when there are none", () => {
    expect(mediaAttachments(sms())).toEqual([]);
  });
});

describe("toArchiveRow", () => {
  it("maps an inbound text", () => {
    expect(toArchiveRow(sms(), OURS)).toEqual({
      rcMessageId: "1",
      phone: PATIENT,
      last4: "1850",
      direction: "Inbound",
      body: "hello",
      messageStatus: "",
      deliveryError: null,
      attachments: null,
      createdAt: "2026-08-15T12:00:00.000Z",
    });
  });

  /** RingCentral's late delivery verdict. The thread is the ONLY surface it
   *  ever reaches, so an archive that dropped it would turn a message the
   *  carrier rejected into an ordinary sent bubble, permanently. */
  it("carries the delivery verdict", () => {
    const r = toArchiveRow(sms({ messageStatus: "SendingFailed", deliveryErrorCode: "SMS-CAR-411" }), OURS);
    expect(r.messageStatus).toBe("SendingFailed");
    expect(r.deliveryError).toBe("SMS-CAR-411");
  });

  it("prefers subject, falls back to text, then to empty", () => {
    expect(toArchiveRow(sms({ subject: undefined, text: "from text" }), OURS).body).toBe("from text");
    expect(toArchiveRow(sms({ subject: undefined, text: undefined }), OURS).body).toBe("");
  });

  it("normalises anything that is not Outbound to Inbound", () => {
    expect(toArchiveRow(sms({ direction: "Unknown" }), OURS).direction).toBe("Inbound");
  });

  it.each([
    ["a fax", sms({ type: "Fax" })],
    ["no id", sms({ id: undefined })],
    ["an empty id", sms({ id: "" })],
    ["no timestamp", sms({ creationTime: undefined })],
    ["no patient side", sms({ direction: "Outbound", from: { phoneNumber: OURS[0] }, to: [{ phoneNumber: OURS[0] }] })],
  ])("stores nothing for %s", (_label, record) => {
    expect(toArchiveRow(record, OURS)).toBeNull();
  });
});

describe("mergeConversation", () => {
  const live = { id: "2", direction: "Outbound", text: "b", time: "2026-08-02T00:00:00Z", messageStatus: "Delivered" };
  const old = { id: "1", direction: "Inbound", text: "a", time: "2026-06-01T00:00:00Z", archived: true };

  it("unions both halves, oldest first", () => {
    expect(mergeConversation([live], [old]).map((m) => m.id)).toEqual(["1", "2"]);
  });

  it("keeps the archived marker on messages RingCentral no longer holds", () => {
    expect(mergeConversation([live], [old])[0].archived).toBe(true);
  });

  /** THE case this ordering exists for. A text archived while still `Queued`
   *  gets its real verdict seconds later; preferring the archive would pin the
   *  optimistic status and re-introduce the bug the field exists to prevent. */
  it("live wins a collision, so a stale status can never mask a real failure", () => {
    const stale = { id: "2", direction: "Outbound", text: "b", time: live.time, messageStatus: "Queued", archived: true };
    const failed = { ...live, messageStatus: "SendingFailed", deliveryError: "SMS-CAR-411" };
    const [m] = mergeConversation([failed], [stale]);
    expect(m.messageStatus).toBe("SendingFailed");
    expect(m.deliveryError).toBe("SMS-CAR-411");
    expect(m.archived).toBeUndefined();
  });

  it("never duplicates a message present on both sides", () => {
    expect(mergeConversation([live], [{ ...live, archived: true }])).toHaveLength(1);
  });

  it("handles either half being empty", () => {
    expect(mergeConversation([], [old]).map((m) => m.id)).toEqual(["1"]);
    expect(mergeConversation([live], []).map((m) => m.id)).toEqual(["2"]);
    expect(mergeConversation()).toEqual([]);
  });
});

describe("rowToMessage", () => {
  const row = {
    rc_message_id: "9",
    direction: "Outbound",
    body: "hi",
    message_status: "Delivered",
    delivery_error: null,
    attachments: null,
    created_at: new Date("2026-07-01T10:00:00.000Z"),
  };

  it("matches the wire shape the route already returns", () => {
    expect(rowToMessage(row)).toEqual({
      id: "9",
      direction: "Outbound",
      text: "hi",
      time: "2026-07-01T10:00:00.000Z",
      messageStatus: "Delivered",
      archived: true,
    });
  });

  it("includes deliveryError and attachments only when present", () => {
    const m = rowToMessage({ ...row, delivery_error: "SMS-RC-410", attachments: [{ id: "1" }] });
    expect(m.deliveryError).toBe("SMS-RC-410");
    expect(m.attachments).toEqual([{ id: "1" }]);
  });
});

describe("archiveHealth", () => {
  const now = Date.parse("2026-09-01T12:00:00.000Z");

  it("is healthy after a recent successful run", () => {
    const h = archiveHealth({ lastOkAt: now - 3600_000, rows: 5000, now });
    expect(h.ok).toBe(true);
    expect(h.stale).toBe(false);
    expect(h.ageHours).toBe(1);
    expect(h.reason).toBeNull();
  });

  it("goes stale well before data would start aging out unsaved", () => {
    expect(STALE_AFTER_MS).toBeLessThan(WINDOW_DAYS * 24 * 3600_000);
    const h = archiveHealth({ lastOkAt: now - STALE_AFTER_MS - 1000, rows: 5000, now });
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/last successful run/);
  });

  /** A job deployed but never actually running is the silent failure this whole
   *  endpoint exists for — rows on the table must not make it look healthy. */
  it("is NOT ok when no run has ever succeeded, however many rows exist", () => {
    const h = archiveHealth({ lastOkAt: null, lastRunAt: now, rows: 5000, now });
    expect(h.ok).toBe(false);
    expect(h.reason).toBe("no successful run recorded yet");
    expect(h.ageHours).toBeNull();
  });

  /** A pass that completed without reading the whole window is the one outcome
   *  that looks exactly like success. Raised in review 2026-09-01: `truncated`
   *  was recorded on the run row and then never consulted. */
  it("a truncated run is NOT healthy, however recent it was", () => {
    const h = archiveHealth({ lastOkAt: now - 60_000, lastTruncated: true, rows: 5000, now });
    expect(h.ok).toBe(false);
    expect(h.truncated).toBe(true);
    expect(h.stale).toBe(false);
    expect(h.reason).toMatch(/page ceiling/);
  });

  it("an untruncated run reports truncated: false rather than undefined", () => {
    const h = archiveHealth({ lastOkAt: now, rows: 1, now });
    expect(h.truncated).toBe(false);
    expect(h.ok).toBe(true);
  });

  it("staleness outranks truncation in the reason, and either alone fails ok", () => {
    const h = archiveHealth({ lastOkAt: now - STALE_AFTER_MS - 1000, lastTruncated: true, now });
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/last successful run was/);
  });

  it("reports the window and the last error", () => {
    const h = archiveHealth({ lastOkAt: now, lastError: "RingCentral message-store failed (429)", now });
    expect(h.windowDays).toBe(WINDOW_DAYS);
    expect(h.lastError).toBe("RingCentral message-store failed (429)");
  });
});

describe("upsertSql", () => {
  const placeholders = (sql) => [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));

  it("numbers every placeholder exactly once across all rows", () => {
    for (const n of [1, 3, 100]) {
      const used = placeholders(upsertSql(n));
      expect(used).toHaveLength(n * 9);
      expect(new Set(used).size).toBe(n * 9);
      expect(Math.max(...used)).toBe(n * 9);
    }
  });

  it("re-reads the fields that can change after we first saw a message", () => {
    const sql = upsertSql(1);
    expect(sql).toContain("ON CONFLICT (rc_message_id) DO UPDATE");
    expect(sql).toContain("message_status = EXCLUDED.message_status");
    expect(sql).toContain("delivery_error = EXCLUDED.delivery_error");
  });

  /** archived_at means "when we first captured this" and created_at is
   *  RingCentral's own. Either being rewritten on every nightly run would
   *  destroy the only evidence of when a message was actually saved. */
  it("never rewrites archived_at or created_at", () => {
    const sql = upsertSql(1);
    expect(sql).not.toContain("archived_at = EXCLUDED");
    expect(sql).not.toContain("created_at = EXCLUDED");
  });
});

describe("phone helpers", () => {
  it("last10 and last4 ignore formatting", () => {
    expect(last10("(718) 633-1850")).toBe("7186331850");
    expect(last4("+17186331850")).toBe("1850");
    expect(last4("12")).toBe("");
  });
});

/**
 * Source-level guard, in the spirit of listColumns.test.ts / searchCoverage.test.ts.
 *
 * The archive was added under one hard constraint: it must not affect patient
 * texting. The write side is isolated by construction (own tables, own routes,
 * `background` tier), but the READ side touches the live conversation route, so
 * the guard that keeps it inert is a flag — and a flag is exactly the kind of
 * thing a later cleanup deletes as "dead config". These fail if that happens.
 */
describe("messaging is unaffected while the archive is off", () => {
  const src = gatewaySrc("messaging.mjs");

  it("the flag is opt-in: anything other than an explicit \"1\" is off", () => {
    expect(src).toMatch(/const SERVE_ARCHIVE = process\.env\.SMS_ARCHIVE_SERVE === "1"/);
  });

  it("the only archive read on the conversation route sits behind that flag", () => {
    const guarded = src.slice(src.indexOf("if (SERVE_ARCHIVE) {"));
    const call = "readArchivedConversation(";
    // Exactly one call site, and it is after the guard opens.
    expect(src.split(call).length - 1).toBe(1);
    expect(guarded).toContain(call);
  });

  it("a failing archive read cannot surface to the caller", () => {
    const block = src.slice(src.indexOf("if (SERVE_ARCHIVE) {"), src.indexOf("// Attribution."));
    expect(block).toContain("try {");
    expect(block).toContain("catch");
    // No status/throw inside the guarded block — it may only add messages.
    expect(block).not.toMatch(/res\.status|throw /);
  });

  it("the archive service can be killed from Railway without a revert", () => {
    const svc = gatewaySrc("smsArchive.mjs");
    expect(svc).toMatch(/SMS_ARCHIVE_ENABLED === "0"/);
  });

  /** The gateway's RingCentral account is shared with live patient texting, so
   *  an endpoint that spends it on demand is the 2026-08-20 incident with a
   *  URL. Raised in review 2026-09-01: the force-run route had neither guard.
   *  `running` is not one — it blocks concurrent runs, not sequential ones. */
  it("the force-run route is authenticated and rate-floored", () => {
    const svc = gatewaySrc("smsArchive.mjs");
    const start = svc.indexOf('app.post("/messaging/archive-run"');
    expect(start).toBeGreaterThan(-1);
    // Bounded by the next top-level statement, not by the first "});" — the
    // 429 response contains one, which silently truncated this to nothing.
    const end = svc.indexOf("\n  void (async", start);
    expect(end).toBeGreaterThan(start);
    const handler = svc.slice(start, end);
    expect(handler).toContain("requireCaller(req, res)");
    expect(handler).toContain("FORCE_MIN_GAP_MS");
    expect(handler).toContain("429");
    // The floor is stamped before the scan, or a burst is capped by how long
    // each scan takes rather than by the floor.
    expect(handler.indexOf("lastForcedAt = Date.now()")).toBeLessThan(handler.indexOf("reconcileSmsArchive"));
  });

  it("messaging actually hands the archive its auth guard", () => {
    expect(gatewaySrc("messaging.mjs")).toContain("registerSmsArchive({ app, pool, requireCaller })");
  });

  /** RingCentral reads for bulk work must be shed before anything a rep is
   *  waiting on. This is the rule that keeps a nightly scan from becoming the
   *  2026-08-20 incident. */
  it("reconcile reads RingCentral on the background tier", () => {
    const svc = gatewaySrc("smsArchive.mjs");
    expect(svc).toMatch(/tier:\s*"background",\s*caller:\s*"sms-archive"/);
  });
});
