import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  ENQUEUE_DAYS,
  MAX_ATTEMPTS,
  MAX_BYTES,
  MEDIA_GAP_MS,
  PER_RUN_BUDGET,
  PER_RUN_BUSY_BUDGET,
  URL_TTL_SECONDS,
  archiveHealth,
  drainBudget,
  extensionForMedia,
  fallbackFilename,
  isOfficeHours,
  last10,
  last4,
  looksLikeMedia,
  nextAudioState,
  objectKey,
  windowStart,
} from "./mmsArchiveRules.mjs";
import {
  extensionFor as callExtensionFor,
  isOfficeHours as callIsOfficeHours,
  last4 as callLast4,
  nextAudioState as callNextAudioState,
  windowStart as callWindowStart,
} from "./callArchiveRules.mjs";
import { WINDOW_DAYS as SMS_WINDOW_DAYS, isArchivable, mediaAttachments } from "./smsArchiveRules.mjs";

/** Same shape as the other gateway suites: resolve from the repo root, since
 *  import.meta.url is not a file: URL under the jsdom environment. */
const gatewaySrc = (f) => readFileSync(resolve(process.cwd(), "services/monday-gateway", f), "utf8");

/** Comments in these modules describe the very things they must not do, so a
 *  raw-text scan fails on its own prose and the only way to pass it is to
 *  delete the explanation. Strip comments first. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("mmsArchiveRules — the shared rules are re-exported, never re-implemented", () => {
  it("re-exports the call archive's own functions, by identity", () => {
    // Not "behaves the same" — the SAME OBJECT. `gone` is terminal and nothing
    // retries it, so two readings of "is this really gone" is two chances to
    // throw a patient's photo away.
    expect(nextAudioState).toBe(callNextAudioState);
    expect(isOfficeHours).toBe(callIsOfficeHours);
    expect(last4).toBe(callLast4);
    expect(windowStart).toBe(callWindowStart);
  });

  it("does NOT re-export extensionFor, because that one guesses audio", () => {
    // The one genuine divergence in the file. extensionFor returns "mp3" for
    // anything it does not recognise — right when every input is a recording,
    // and catastrophic here: it would name an insurance-card photo .mp3.
    expect(extensionForMedia).not.toBe(callExtensionFor);
    expect(callExtensionFor("image/jpeg")).toBe("mp3");
    expect(extensionForMedia("image/jpeg")).toBe("jpg");
  });

  it("defines none of the shared rules locally", () => {
    const src = stripComments(gatewaySrc("mmsArchiveRules.mjs"));
    for (const fn of ["nextAudioState", "isOfficeHours", "last4", "last10", "windowStart"]) {
      expect(src).not.toMatch(new RegExp(`function\\s+${fn}\\s*\\(`));
    }
  });

  it("keeps last10 and last4 consistent with each other", () => {
    expect(last10("+1 (607) 873-7352")).toBe("6078737352");
    expect(last4("+1 (607) 873-7352")).toBe("7352");
  });
});

describe("extensionForMedia — an extension that lies is worse than one that admits it", () => {
  it("names the shapes an MMS actually carries", () => {
    expect(extensionForMedia("image/jpeg")).toBe("jpg");
    expect(extensionForMedia("image/png")).toBe("png");
    expect(extensionForMedia("image/gif")).toBe("gif");
    expect(extensionForMedia("image/heic")).toBe("heic");
    expect(extensionForMedia("video/3gpp")).toBe("3gp");
    expect(extensionForMedia("video/mp4")).toBe("mp4");
    expect(extensionForMedia("text/vcard")).toBe("vcf");
    expect(extensionForMedia("application/pdf")).toBe("pdf");
  });

  it("delegates audio to the call archive, so the two cannot disagree", () => {
    // An MMS really can carry an audio part, and that is the one family the
    // two rules share.
    for (const t of ["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "audio/x-m4a"]) {
      expect(extensionForMedia(t)).toBe(callExtensionFor(t));
    }
  });

  it("falls back to bin, never to a guess", () => {
    // An unknown type saved as .bin is honest and still openable by anyone who
    // reads content_type. An unknown type saved as .jpg is a lie that spreads.
    expect(extensionForMedia("application/octet-stream")).toBe("bin");
    expect(extensionForMedia("")).toBe("bin");
    expect(extensionForMedia(undefined)).toBe("bin");
    expect(extensionForMedia("x-weird/thing")).toBe("bin");
  });

  it("tolerates a charset and odd casing, as a real header carries", () => {
    expect(extensionForMedia("IMAGE/JPEG; charset=binary")).toBe("jpg");
    expect(extensionForMedia("  text/vcard ")).toBe("vcf");
  });
});

describe("looksLikeMedia — a 200 is not a photo", () => {
  it("rejects an empty body however it is labelled", () => {
    expect(looksLikeMedia({ contentType: "image/jpeg", expectedContentType: "image/jpeg", bytes: 0 })).toBe(false);
    expect(looksLikeMedia({ contentType: "image/jpeg", bytes: undefined })).toBe(false);
  });

  it("accepts the type sms_archive recorded", () => {
    expect(
      looksLikeMedia({ contentType: "image/jpeg", expectedContentType: "image/jpeg", bytes: 40_000 }),
    ).toBe(true);
    // A charset on one side and not the other is the same type.
    expect(
      looksLikeMedia({ contentType: "image/jpeg; charset=binary", expectedContentType: "image/jpeg", bytes: 1 }),
    ).toBe(true);
  });

  it("rejects the error shapes a 200 can carry", () => {
    // The trap fetchAssetBytes documents: an AccessDenied body served as a 200,
    // which an archive would otherwise store as the photo and call success.
    for (const t of ["text/html", "application/xml", "text/xml", "application/json"]) {
      expect(looksLikeMedia({ contentType: t, expectedContentType: "image/jpeg", bytes: 512 })).toBe(false);
    }
  });

  it("does NOT reject everything under text/, because a vCard is real media", () => {
    expect(looksLikeMedia({ contentType: "text/vcard", expectedContentType: "text/vcard", bytes: 300 })).toBe(true);
    expect(looksLikeMedia({ contentType: "text/vcard", expectedContentType: "", bytes: 300 })).toBe(true);
  });

  it("is permissive on an unfamiliar type, and that direction is deliberate", () => {
    // The two mistakes are not symmetric. A stored error page is a visible,
    // fixable row with its size and type in last_error; a discarded photo is
    // gone in thirty days.
    expect(looksLikeMedia({ contentType: "image/heif", expectedContentType: "image/jpeg", bytes: 9 })).toBe(true);
    expect(looksLikeMedia({ contentType: "", expectedContentType: "", bytes: 9 })).toBe(true);
  });
});

describe("objectKey — the attachment id is in the key", () => {
  const base = {
    createdAt: "2026-09-21T16:30:00.000Z",
    rcMessageId: "9001",
    rcAttachmentId: "5001",
    ext: "jpg",
  };

  it("partitions by UTC under its own prefix", () => {
    expect(objectKey(base)).toBe("mms/2026/09/21/9001_5001.jpg");
  });

  it("keeps two parts of one message apart", () => {
    // The upload is idempotent by key precisely so a retry overwrites rather
    // than duplicating — so a key naming only the message would have the second
    // part silently overwrite the first.
    const a = objectKey(base);
    const b = objectKey({ ...base, rcAttachmentId: "5002" });
    expect(a).not.toBe(b);
  });

  it("never shares a prefix with the other two archives", () => {
    expect(objectKey(base).startsWith("mms/")).toBe(true);
    expect(objectKey(base)).not.toMatch(/^(recordings|voicemails)\//);
  });

  it("refuses rather than inventing a key", () => {
    expect(objectKey({ ...base, rcMessageId: "" })).toBe(null);
    expect(objectKey({ ...base, rcAttachmentId: "" })).toBe(null);
    expect(objectKey({ ...base, createdAt: "not a date" })).toBe(null);
  });

  it("strips anything that could escape the prefix", () => {
    expect(objectKey({ ...base, rcMessageId: "../../etc/passwd" })).toBe("mms/2026/09/21/etcpasswd_5001.jpg");
  });

  it("uses UTC, so a late-evening Eastern photo does not land on the wrong day", () => {
    // 2026-09-21T23:30 ET is 2026-09-22T03:30Z.
    expect(objectKey({ ...base, createdAt: "2026-09-22T03:30:00.000Z" })).toBe("mms/2026/09/22/9001_5001.jpg");
  });
});

describe("fallbackFilename — a name with no PHI beyond four digits", () => {
  it("carries the stamp and the last four", () => {
    expect(fallbackFilename({ createdAt: "2026-09-21T16:30:00.000Z", last4: "7352", ext: "jpg" })).toBe(
      "mms_2026-09-21-16-30Z_x7352.jpg",
    );
  });
  it("copes with no last4 and no date", () => {
    expect(fallbackFilename({ createdAt: "nope", ext: "png" })).toBe("mms_undatedZ.png");
  });
});

describe("budgets and window", () => {
  it("brakes during office hours", () => {
    // Tuesday 14:00 ET.
    expect(drainBudget(new Date("2026-09-22T18:00:00.000Z"))).toBe(PER_RUN_BUSY_BUDGET);
    // Tuesday 03:00 ET.
    expect(drainBudget(new Date("2026-09-22T07:00:00.000Z"))).toBe(PER_RUN_BUDGET);
    expect(PER_RUN_BUSY_BUDGET).toBeLessThan(PER_RUN_BUDGET);
  });

  it("enqueues over a window LONGER than the SMS archive's own", () => {
    // A message enters sms_archive at the very edge of ITS window, so an
    // enqueue bounded at the same number could miss a row by hours.
    expect(ENQUEUE_DAYS).toBeGreaterThan(SMS_WINDOW_DAYS);
  });

  it("paces downloads at the heavy-group rate", () => {
    // 10 requests/60s is the HEAVY group; being slower costs nothing at this
    // volume, being faster costs 429s on the line that carries patient texting.
    expect(MEDIA_GAP_MS).toBeGreaterThanOrEqual(6_000);
  });

  it("caps a presigned URL's life at an hour", () => {
    expect(URL_TTL_SECONDS).toBeLessThanOrEqual(3600);
  });

  it("windowStart is the shared helper's answer", () => {
    const now = Date.parse("2026-09-21T00:00:00.000Z");
    expect(windowStart(now, 10)).toBe(callWindowStart(now, 10));
  });

  it("has a size ceiling well above a real MMS", () => {
    expect(MAX_BYTES).toBeGreaterThan(1024 * 1024);
  });

  it("retires a genuinely unfetchable part rather than retrying for ever", () => {
    expect(nextAudioState({ status: 500, attempts: MAX_ATTEMPTS, maxAttempts: MAX_ATTEMPTS })).toBe("failed");
    expect(nextAudioState({ status: 500, attempts: 1, maxAttempts: MAX_ATTEMPTS })).toBe("pending");
    expect(nextAudioState({ status: 404, attempts: 1, maxAttempts: MAX_ATTEMPTS })).toBe("gone");
  });
});

describe("archiveHealth — every failure mode here is silent", () => {
  const ok = {
    lastOkAt: "2026-09-21T12:00:00.000Z",
    lastCompleteAt: "2026-09-21T12:00:00.000Z",
    lastRunAt: "2026-09-21T12:00:00.000Z",
    rows: 40,
    stored: 38,
    pending: 2,
    failed: 0,
    gone: 0,
    bytes: 4_000_000,
    presignOk: true,
    now: Date.parse("2026-09-21T13:00:00.000Z"),
  };

  it("is ok when a recent complete run stored media and it can be served", () => {
    const h = archiveHealth(ok);
    expect(h.ok).toBe(true);
    expect(h.reason).toBe(null);
  });

  it("is NOT ok when no run has ever finished", () => {
    // However many rows the table holds. A job deployed but never running must
    // not report healthy on data somebody else's run put there.
    const h = archiveHealth({ ...ok, lastOkAt: null, lastCompleteAt: null, rows: 500, stored: 500 });
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/no successful run/i);
  });

  it("is NOT ok when every pass so far was shed, and says so distinctly", () => {
    // The whole reason lastCompleteAt exists: a shed run is recorded ok — it
    // did what it could — but it did not drain, so measuring on `ok` alone
    // would let an archive that sheds every run report healthy for ever.
    const h = archiveHealth({ ...ok, lastCompleteAt: null });
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/cut short|shed/i);
    expect(h.reason).not.toMatch(/no successful run/i);
  });

  it("measures staleness on the COMPLETE run, not the ok one", () => {
    const h = archiveHealth({
      ...ok,
      // ok an hour ago, but the last pass that actually drained was two days ago.
      lastOkAt: "2026-09-21T12:00:00.000Z",
      lastCompleteAt: "2026-09-19T12:00:00.000Z",
    });
    expect(h.ok).toBe(false);
    expect(h.stale).toBe(true);
  });

  it("does not page for a backlog", () => {
    // A backfill looks exactly like a backlog, and an alert that fires for a
    // working system is the one everybody swipes away.
    const h = archiveHealth({ ...ok, pending: 4000, stored: 1 });
    expect(h.ok).toBe(true);
    expect(h.oldestPendingHours).toBe(null);
  });

  it("exposes how long the oldest pending part has waited", () => {
    const h = archiveHealth({ ...ok, oldestPendingAt: "2026-09-20T13:00:00.000Z" });
    expect(h.oldestPendingHours).toBe(24);
  });

  it("puts the un-servable case ahead of the failed count", () => {
    // Media being saved perfectly and NONE of it fetchable is worse than a few
    // parts we could not get, and it wears the costume of a working archive.
    const h = archiveHealth({ ...ok, presignOk: false, failed: 3 });
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/cannot be served/i);
  });

  it("is not ok when anything is parked failed", () => {
    const h = archiveHealth({ ...ok, failed: 2 });
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/could not fetch/i);
  });

  it("reports `gone` without ever treating it as a fault", () => {
    // It is the standing detector for RingCentral shortening its retention:
    // the oldest queued media starts coming back 404 and this number climbs.
    const h = archiveHealth({ ...ok, gone: 17 });
    expect(h.ok).toBe(true);
    expect(h.gone).toBe(17);
  });

  it("nothing stored yet is not a presign failure", () => {
    const h = archiveHealth({ ...ok, presignOk: null, stored: 0 });
    expect(h.ok).toBe(true);
    expect(h.presignOk).toBe(null);
  });

  it("never leaks a number or a message id", () => {
    const h = archiveHealth(ok);
    const text = JSON.stringify(h);
    expect(text).not.toMatch(/\d{10}/);
    expect(Object.keys(h)).not.toContain("phone");
  });
});

describe("the queue is sms_archive, and that coupling is the thing to protect", () => {
  it("sms_archive still records MMS media with its uri", () => {
    // If mediaAttachments ever stops recording attachments, this archive goes
    // silently empty — there is no RingCentral scan here to notice.
    expect(isArchivable({ type: "MMS" })).toBe(true);
    const parts = mediaAttachments({
      attachments: [
        { id: 1, type: "Text", contentType: "text/plain", uri: "u0" },
        { id: 2, contentType: "image/jpeg", uri: "u1" },
      ],
    });
    expect(parts).toEqual([{ id: 2, contentType: "image/jpeg", uri: "u1" }]);
  });

  it("the enqueue reads sms_archive and never RingCentral", () => {
    const src = stripComments(gatewaySrc("mmsArchive.mjs"));
    const fn = src.slice(src.indexOf("export async function enqueueFromSmsArchive"), src.indexOf("export async function drainMediaQueue"));
    expect(fn).toMatch(/FROM sms_archive/);
    expect(fn).not.toMatch(/rcApiFetch|rcMediaFetch|message-store\?/);
  });

  it("there is no RingCentral metadata scan anywhere in the module", () => {
    // The simplification that removes three failure modes. If a scan is ever
    // added, the health verdict needs a `truncated` twin to go with it.
    const src = stripComments(gatewaySrc("mmsArchive.mjs"));
    expect(src).not.toMatch(/rcApiFetch/);
  });

  it("the enqueue never writes media_state", () => {
    // It is reading a column that says a photo was attached, not one that says
    // we saved it — so any write there would reset a stored row to pending and
    // re-download it for ever.
    const src = stripComments(gatewaySrc("mmsArchive.mjs"));
    const fn = src.slice(src.indexOf("export async function enqueueFromSmsArchive"), src.indexOf("export async function drainMediaQueue"));
    const conflict = fn.slice(fn.indexOf("ON CONFLICT"));
    expect(conflict).not.toMatch(/media_state/);
  });

  it("the enqueue is bounded, so it cannot re-walk a keep-forever table for ever", () => {
    const src = stripComments(gatewaySrc("mmsArchive.mjs"));
    const fn = src.slice(src.indexOf("export async function enqueueFromSmsArchive"), src.indexOf("export async function drainMediaQueue"));
    expect(fn).toMatch(/created_at >= now\(\) - /);
  });
});

describe("mmsArchive.mjs — the protections that are correctness, not style", () => {
  const src = () => stripComments(gatewaySrc("mmsArchive.mjs"));
  const drain = () => {
    const s = src();
    return s.slice(s.indexOf("export async function drainMediaQueue"), s.indexOf("let running = false"));
  };

  it("drains oldest first, because oldest is closest to deletion", () => {
    expect(drain()).toMatch(/ORDER BY created_at ASC/);
  });

  it("writes the object BEFORE it claims to have stored it", () => {
    const d = drain();
    const put = d.indexOf("await putObject(");
    const mark = d.indexOf("media_state = 'stored'");
    expect(put).toBeGreaterThan(-1);
    expect(mark).toBeGreaterThan(-1);
    expect(put).toBeLessThan(mark);
    // Exactly one of each inside this function, so the ordering assertion above
    // cannot be satisfied by some other occurrence elsewhere.
    expect(d.match(/await putObject\(/g)).toHaveLength(1);
    expect(d.match(/media_state = 'stored'/g)).toHaveLength(1);
  });

  it("a 429 does not burn an attempt", () => {
    // Attempts exist to retire a part that is genuinely unfetchable; a throttle
    // says nothing about this part at all, and counting it would park good
    // photos as `failed` — terminal for the automatic retry.
    const d = drain();
    const i = d.indexOf("up.status === 429");
    expect(i).toBeGreaterThan(-1);
    const block = d.slice(i, i + 300);
    expect(block).toMatch(/mediaTried--/);
    expect(block).toMatch(/return;/);
  });

  it("checks the body is media before storing it, as a GUARD", () => {
    // ⚠️ Asserting the call is present is not enough — a call whose result is
    // discarded reads identically. The shape is what matters: a negated test
    // that reaches a failure path.
    const d = drain();
    const i = d.indexOf("if (!looksLikeMedia(");
    expect(i).toBeGreaterThan(-1);
    const block = d.slice(i, i + 600);
    expect(block).toMatch(/not media/);
    expect(block).toMatch(/continue;/);
  });

  it("never tests /\\^audio\\// on an MMS body", () => {
    // The call and voicemail archives both do; here it would reject every real
    // attachment, because MMS media is images and video.
    expect(src()).not.toMatch(/\^audio\\\//);
  });

  it("registers on the MESSAGING pool, never index.mjs", () => {
    // PHI: these are photographs of insurance cards. The audit database keeps
    // its no-PHI property only because this table is never created there.
    expect(stripComments(gatewaySrc("messaging.mjs"))).toMatch(/registerMmsArchive\(\{\s*app,\s*pool,\s*requireCaller\s*\}\)/);
    expect(stripComments(gatewaySrc("index.mjs"))).not.toMatch(/registerMmsArchive/);
  });

  it("the health route survives the kill switch", () => {
    // Flipping the switch during an incident must not make the health check
    // 404, which a monitor reports as a fresh problem of its own.
    const s = src();
    const disabled = s.slice(s.indexOf("if (disabled) {"), s.indexOf("if (!storeConfigured()) {"));
    expect(disabled).toMatch(/app\.get\("\/mms\/archive-health"/);
  });

  it("the forced run is authenticated AND rate-floored", () => {
    const s = src();
    const route = s.slice(s.indexOf('app.post("/mms/archive-run"'), s.indexOf('app.get("/mms/media"'));
    expect(route).toMatch(/const who = await caller\(req, res\);/);
    // ⚠️ The COMPARISON, not the constant: FORCE_MIN_GAP_MS also appears in
    // the retryAfterSeconds arithmetic, so a presence check still matched with
    // the floor itself removed.
    expect(route).toMatch(/if \(since < FORCE_MIN_GAP_MS\)/);
  });

  it("audits every presigned URL it issues", () => {
    // An untracked bearer credential for a patient's document is
    // indistinguishable from a leak.
    const s = src();
    const route = s.slice(s.indexOf('app.get("/mms/media"'), s.indexOf('app.post("/mms/archive/query"'));
    expect(route).toMatch(/INSERT INTO mms_archive_access/);
    expect(route).toMatch(/presignGet\(/);
  });

  it("the presign self-check is a ranged GET, never a HEAD", () => {
    // SigV4 signs the METHOD, so a URL signed from a GetObjectCommand is a
    // GET-only URL and a HEAD to it is SignatureDoesNotMatch every time — a
    // false alarm on the one signal that exists to be trusted.
    const s = src();
    const fn = s.slice(s.indexOf("async function refreshPresignCheck"), s.indexOf("const SERVICE_TOKEN"));
    expect(fn).toMatch(/method: "GET"/);
    expect(fn).toMatch(/Range: "bytes=0-0"/);
    expect(fn).not.toMatch(/method: "HEAD"/);
  });

  it("a query failure is an error, never an empty result", () => {
    const s = src();
    const route = s.slice(s.indexOf('app.post("/mms/archive/query"'));
    expect(route).toMatch(/res\.status\(502\)/);
  });

  it("an explicit id list is not date-bounded", () => {
    // A caller asking about specific messages already knows which it wants;
    // dropping the old ones would answer "we hold no media" about a photo
    // sitting in the bucket — the exact wrong answer for the aged-out
    // messages this archive exists for.
    const s = src();
    const route = s.slice(s.indexOf('app.post("/mms/archive/query"'));
    const i = route.indexOf("if (messageIds.length) {");
    const branch = route.slice(i, route.indexOf("if (phones.length) {"));
    expect(branch).toMatch(/rc_message_id = ANY/);
    expect(branch.slice(0, branch.indexOf("} else {"))).not.toMatch(/created_at >=/);
  });

  it("answers with last4 and never a number", () => {
    const s = src();
    const fn = s.slice(s.indexOf("function publicRow"), s.indexOf("export function registerMmsArchive"));
    expect(fn).toMatch(/last4: r\.last4/);
    expect(fn).not.toMatch(/phone_hmac|phoneNumber/);
  });

  it("the module actually parses — no stray backtick inside a SQL literal", () => {
    // ⚠️ voicemailArchive.mjs earned this rule the hard way: a SQL comment
    // containing backticks terminated the JS template literal it lived in and
    // the module would not load at all.
    //
    // ⚠️ The first version of this test scanned for backticks inside
    // SQL-looking template literals — and could not see the one thing it was
    // for: a stray backtick makes the literal stop matching the pattern, so the
    // scan silently skipped it and passed. Asking Node to parse the file is the
    // property actually wanted, and it cannot be fooled. (The suite cannot
    // simply import the module: it pulls in google-auth-library.)
    const file = resolve(process.cwd(), "services/monday-gateway/mmsArchive.mjs");
    expect(() => execFileSync(process.execPath, ["--check", file], { stdio: "pipe" })).not.toThrow();
  });
});
