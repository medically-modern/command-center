import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AUDIO_GAP_MS,
  MAX_ATTEMPTS,
  PAGE_SIZE,
  PER_RUN_BUDGET,
  PER_RUN_BUSY_BUDGET,
  SCAN_GAP_MS,
  TRANSCRIPT_BUDGET,
  URL_TTL_SECONDS,
  WINDOW_DAYS,
  archiveHealth,
  audioAttachment,
  counterpartyNumber,
  drainBudget,
  extensionFor,
  fallbackFilename,
  isVoicemail,
  last4,
  nextAudioState,
  objectKey,
  toVoicemailRow,
  transcriptAttachment,
  windowStart,
} from "./voicemailArchiveRules.mjs";
import { extensionFor as callExtensionFor, nextAudioState as callNextAudioState } from "./callArchiveRules.mjs";

/** Same shape as the other gateway suites: resolve from the repo root, since
 *  import.meta.url is not a file: URL under the jsdom environment. */
const gatewaySrc = (f) => readFileSync(resolve(process.cwd(), "services/monday-gateway", f), "utf8");

const vm = (over = {}) => ({
  id: 9001,
  type: "VoiceMail",
  direction: "Inbound",
  creationTime: "2026-09-21T16:30:00.000Z",
  readStatus: "Unread",
  from: { phoneNumber: "+15555550101", name: "WIRELESS CALLER" },
  to: [{ phoneNumber: "+13475037148" }],
  attachments: [
    { id: 5001, type: "AudioRecording", contentType: "audio/mpeg", uri: "https://media.ringcentral.com/restapi/v1.0/account/1/extension/2/message-store/9001/content/5001", vmDuration: 27 },
  ],
  ...over,
});

describe("what counts as a voicemail", () => {
  it("takes VoiceMail and nothing else", () => {
    expect(isVoicemail(vm())).toBe(true);
    for (const t of ["SMS", "MMS", "Fax", "Pager", "", undefined]) {
      expect(isVoicemail({ type: t })).toBe(false);
    }
  });

  // ⚠️ The two archives PARTITION the message store rather than overlapping.
  // smsArchiveRules excludes VoiceMail by name with the comment that archiving
  // one as a text "would be worse than the gap it fills"; that exclusion is
  // what makes this module's existence necessary and non-duplicative, so it is
  // pinned here too — if somebody ever "fixes" it, this fails and names why.
  it("the SMS archive still refuses voicemail, so the two do not overlap", () => {
    const src = gatewaySrc("smsArchiveRules.mjs");
    expect(src).toMatch(/isArchivable/);
    expect(src).toMatch(/t === "SMS" \|\| t === "MMS"/);
    expect(src).not.toMatch(/t === "VoiceMail"/);
  });
});

describe("picking the parts of a voicemail", () => {
  // ⚠️ NEVER attachments[0]. A record carries the audio AND (when the account
  // produces one) a transcript, in an order RingCentral does not promise —
  // taking the first would store a transcript under an .mp3 key.
  it("finds the audio however the transcript is ordered around it", () => {
    const transcriptFirst = vm({
      attachments: [
        { id: 7, contentType: "text/plain", uri: "https://x.ringcentral.com/message-store/9001/content/7" },
        { id: 8, contentType: "audio/wav", uri: "https://x.ringcentral.com/message-store/9001/content/8", vmDuration: 12 },
      ],
    });
    expect(audioAttachment(transcriptFirst)?.id).toBe(8);
    expect(transcriptAttachment(transcriptFirst)?.id).toBe(7);
  });

  it("falls back to type=AudioRecording when the content type is missing", () => {
    const noType = vm({ attachments: [{ id: 3, type: "AudioRecording", uri: "https://x/1" }] });
    expect(audioAttachment(noType)?.id).toBe(3);
  });

  it("never returns an attachment with no uri — there is nothing to fetch", () => {
    expect(audioAttachment(vm({ attachments: [{ id: 1, contentType: "audio/mpeg" }] }))).toBeNull();
    expect(audioAttachment(vm({ attachments: [] }))).toBeNull();
    expect(audioAttachment({})).toBeNull();
  });

  // ⚠️ An absent transcript is the EXPECTED reading on this account, not a
  // defect — transcription is a per-account feature and it is not established
  // that it is on here. Nothing may treat this null as a failure.
  it("reports no transcript without complaining about it", () => {
    expect(transcriptAttachment(vm())).toBeNull();
    expect(transcriptAttachment(vm({ attachments: [] }))).toBeNull();
  });
});

describe("which party is the patient", () => {
  // ⚠️ Getting this backwards collapses every voicemail onto our own main line.
  it("reads `from` inbound and `to` outbound", () => {
    expect(counterpartyNumber(vm())).toBe("+15555550101");
    expect(counterpartyNumber(vm({ direction: "Outbound" }))).toBe("+13475037148");
  });

  it("survives a record with no parties at all", () => {
    expect(counterpartyNumber({})).toBe("");
    expect(counterpartyNumber({ direction: "Outbound", to: [] })).toBe("");
    expect(counterpartyNumber({ direction: "Outbound", to: [{}] })).toBe("");
  });
});

describe("the row we keep", () => {
  it("maps a voicemail to a pending row", () => {
    const row = toVoicemailRow(vm());
    expect(row).toMatchObject({
      rcMessageId: "9001",
      direction: "Inbound",
      phone: "+15555550101",
      last4: "0101",
      durationSec: 27,
      createdAt: "2026-09-21T16:30:00.000Z",
      rcAttachmentId: "5001",
      audioState: "pending",
    });
    expect(row.contentUri).toMatch(/\/message-store\/9001\/content\/5001$/);
  });

  // ⚠️ A voicemail whose audio we cannot see is still KEPT. The metadata ages
  // out of RingCentral with the message too, so "this number left a message at
  // this time and we never got the audio" is a fact somebody can act on;
  // nothing at all is indistinguishable from a patient who never called.
  it("keeps a voicemail with no audio attachment, as `none`", () => {
    const row = toVoicemailRow(vm({ attachments: [] }));
    expect(row.audioState).toBe("none");
    expect(row.contentUri).toBeNull();
    expect(row.rcMessageId).toBe("9001");
  });

  it("refuses anything that is not a keyable voicemail", () => {
    expect(toVoicemailRow({ ...vm(), type: "SMS" })).toBeNull();
    expect(toVoicemailRow(vm({ id: "" }))).toBeNull();
    expect(toVoicemailRow(vm({ creationTime: "" }))).toBeNull();
    expect(toVoicemailRow(vm({ creationTime: "not a date" }))).toBeNull();
  });

  // ⚠️ from.name is caller ID — mostly carrier CNAM junk, occasionally a real
  // patient's name, i.e. a name in the clear for no benefit when the number's
  // HMAC already joins to patient_directory.
  it("never carries the caller-ID name", () => {
    const row = toVoicemailRow(vm());
    expect(JSON.stringify(row)).not.toMatch(/WIRELESS CALLER/);
    expect(Object.keys(row)).not.toContain("name");
  });

  it("carries the transcription status and uri when the account produces them", () => {
    const row = toVoicemailRow(
      vm({
        vmTranscriptionStatus: "Completed",
        attachments: [
          ...vm().attachments,
          { id: 5002, contentType: "text/plain", uri: "https://x.ringcentral.com/message-store/9001/content/5002" },
        ],
      }),
    );
    expect(row.transcriptionStatus).toBe("Completed");
    expect(row.transcriptUri).toMatch(/content\/5002$/);
  });

  it("leaves both null when there is no transcript", () => {
    const row = toVoicemailRow(vm());
    expect(row.transcriptUri).toBeNull();
    expect(row.transcriptionStatus).toBeNull();
  });
});

describe("where an object lives", () => {
  it("is date-partitioned, prefixed and carries both ids", () => {
    expect(
      objectKey({ createdAt: "2026-09-21T16:30:00.000Z", rcMessageId: "9001", rcAttachmentId: "5001", ext: "mp3" }),
    ).toBe("voicemails/2026/09/21/9001_5001.mp3");
  });

  // ⚠️ The prefix is what keeps a listing of the voicemail archive from being a
  // listing of the call recordings beside it in the SAME bucket.
  it("never collides with the call archive's prefix", () => {
    const k = objectKey({ createdAt: "2026-09-21T16:30:00.000Z", rcMessageId: "9001", rcAttachmentId: "5001" });
    expect(k.startsWith("voicemails/")).toBe(true);
    expect(k.startsWith("recordings/")).toBe(false);
  });

  // ⚠️ UTC, not Eastern. A creationTime is a real instant, and UTC has no DST
  // gap or overlap, so the partition boundaries are stable.
  it("partitions by UTC, so a late-evening Eastern message keeps the UTC day", () => {
    // 2026-09-21 21:30 ET is 2026-09-22 01:30 UTC.
    expect(objectKey({ createdAt: "2026-09-22T01:30:00.000Z", rcMessageId: "1", rcAttachmentId: "2" })).toMatch(
      /^voicemails\/2026\/09\/22\//,
    );
  });

  it("strips anything that could escape the key", () => {
    expect(objectKey({ createdAt: "2026-09-21T16:30:00.000Z", rcMessageId: "../../etc/passwd", rcAttachmentId: "a/b" })).toBe(
      "voicemails/2026/09/21/etcpasswd_ab.mp3",
    );
  });

  it("refuses to name an object it cannot key", () => {
    expect(objectKey({ createdAt: "2026-09-21T16:30:00.000Z", rcMessageId: "" })).toBeNull();
    expect(objectKey({ createdAt: "nonsense", rcMessageId: "9001" })).toBeNull();
  });

  it("names a download with four digits and no more", () => {
    const name = fallbackFilename({ createdAt: "2026-09-21T16:30:00.000Z", last4: "0101", ext: "wav" });
    expect(name).toBe("voicemail_2026-09-21-16-30Z_x0101.wav");
    expect(name).not.toMatch(/5555550101/);
  });
});

describe("the shared rules are shared, not copied", () => {
  // ⚠️⚠️ The whole point of re-exporting these. `extensionFor` names an object
  // in the bucket here and a download in the SPA; `nextAudioState` decides a
  // TERMINAL `gone` that nothing ever retries. Two readings of either is two
  // chances to throw audio away, which is the §5.7 hand-synced-mirror hazard.
  it("uses the call archive's own extensionFor and nextAudioState", () => {
    expect(extensionFor).toBe(callExtensionFor);
    expect(nextAudioState).toBe(callNextAudioState);
  });

  it("does not re-implement them", () => {
    const src = gatewaySrc("voicemailArchiveRules.mjs");
    expect(src).toMatch(/from "\.\/callArchiveRules\.mjs"/);
    // A second definition of either would shadow the import silently.
    expect(src).not.toMatch(/export function extensionFor/);
    expect(src).not.toMatch(/export function nextAudioState/);
    expect(src).not.toMatch(/export function isOfficeHours/);
  });

  it("agrees with the SPA about MP3 vs WAV", () => {
    expect(extensionFor("audio/mpeg")).toBe("mp3");
    expect(extensionFor("audio/wav")).toBe("wav");
    expect(extensionFor("audio/x-wav; charset=binary")).toBe("wav");
    expect(extensionFor("")).toBe("mp3");
  });

  it("only ever calls a recording gone on positive evidence", () => {
    expect(nextAudioState({ status: 404, attempts: 1 })).toBe("gone");
    expect(nextAudioState({ status: 410, attempts: 1 })).toBe("gone");
    // ⚠️ 403 is a missing permission, which is a fault to FIX, not a purge.
    expect(nextAudioState({ status: 403, attempts: 1 })).toBe("pending");
    expect(nextAudioState({ status: 403, attempts: MAX_ATTEMPTS })).toBe("failed");
  });
});

describe("the window and the pacing", () => {
  // ⚠️ A window SHORTER than RingCentral's real ~30-day retention loses
  // voicemail silently — there is no surviving row to notice, the way a purged
  // recording at least leaves its call-log entry behind.
  it("reads further back than the message store actually holds", () => {
    expect(WINDOW_DAYS).toBeGreaterThan(30);
  });

  it("starts the window where it says it does", () => {
    const now = Date.parse("2026-09-21T00:00:00.000Z");
    expect(windowStart(now, 35)).toBe("2026-08-17T00:00:00.000Z");
  });

  // ⚠️ Set to the call archive's HEAVY-group pace even though it is not
  // established that message-store content is in that group. Being slower than
  // necessary costs nothing at ~90 records a window; being faster than the real
  // ceiling costs 429s on the account that carries live patient texting.
  it("paces downloads at or below one every six seconds", () => {
    expect(AUDIO_GAP_MS).toBeGreaterThanOrEqual(6_000);
  });

  // ⚠️ The SCAN is what drew real 429s on the call archive's first live run — a
  // sustained rate is gentle, a burst is what a rate limiter notices.
  it("paces the pages too", () => {
    expect(SCAN_GAP_MS).toBeGreaterThan(0);
  });

  // ⚠️ The early brake: rcLimiter's shed floor only engages once the account is
  // already busy, which is when a rep is waiting on a thread.
  it("takes a smaller bite while the office is working", () => {
    expect(PER_RUN_BUSY_BUDGET).toBeLessThan(PER_RUN_BUDGET);
    const tuesdayNoonEt = new Date("2026-09-22T16:00:00.000Z");
    const tuesdayThreeAmEt = new Date("2026-09-22T07:00:00.000Z");
    expect(drainBudget(tuesdayNoonEt)).toBe(PER_RUN_BUSY_BUDGET);
    expect(drainBudget(tuesdayThreeAmEt)).toBe(PER_RUN_BUDGET);
  });

  // ⚠️ A transcript may be worth nothing on this account, so it must never
  // crowd out the thing that actually matters.
  it("keeps the transcript budget separate from the audio budget", () => {
    expect(TRANSCRIPT_BUDGET).toBeGreaterThan(0);
    expect(TRANSCRIPT_BUDGET).not.toBe(PER_RUN_BUDGET);
  });

  it("caps the page size at what the message store accepts", () => {
    expect(PAGE_SIZE).toBeGreaterThan(0);
    expect(PAGE_SIZE).toBeLessThanOrEqual(1000);
  });

  // ⚠️ A presigned URL is a bearer credential for PHI. Minutes, not hours.
  it("keeps presigned URLs short-lived", () => {
    expect(URL_TTL_SECONDS).toBeLessThanOrEqual(3600);
    expect(URL_TTL_SECONDS).toBeGreaterThanOrEqual(30);
  });
});

describe("archiveHealth", () => {
  const base = {
    lastOkAt: new Date().toISOString(),
    lastCompleteAt: new Date().toISOString(),
    rows: 90,
    stored: 88,
    pending: 2,
    failed: 0,
    gone: 0,
    none: 0,
    transcripts: 0,
    bytes: 12_000_000,
    presignOk: true,
  };

  it("is ok when the job is keeping up", () => {
    expect(archiveHealth(base).ok).toBe(true);
  });

  // ⚠️ However many rows the table holds. A job deployed but never actually
  // running is the failure this whole module exists to prevent, and an archive
  // full of rows from a previous deploy looks exactly like one that is working.
  it("is NOT ok when no run has ever succeeded", () => {
    const h = archiveHealth({ ...base, lastOkAt: null, lastCompleteAt: null });
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/no successful run/i);
  });

  it("is not ok when the window has not been read for hours", () => {
    const h = archiveHealth({ ...base, lastCompleteAt: new Date(Date.now() - 48 * 3600_000).toISOString() });
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/48h/);
  });

  // ⚠️⚠️ THE ONE THAT REPLACES THE CALL ARCHIVE'S DEEP/SHALLOW BOOKKEEPING.
  // A run cut short by the rate limiter is still recorded `ok` — it did what it
  // could, and losing that signal would be worse — but it did NOT read the
  // window. Measuring staleness on `ok` alone lets an archive that sheds every
  // single pass report healthy forever while the 30-day window closes on
  // everything in it.
  it("is not ok when every run succeeds but none of them reads the whole window", () => {
    const h = archiveHealth({ ...base, lastOkAt: new Date().toISOString(), lastCompleteAt: null });
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/cut short/i);
  });

  // ...and ONE shed run is routine and trips nothing, because the clock is what
  // decides. An alert that fires for a working system is the one that teaches
  // everybody to swipe these away.
  it("stays ok through an occasional shed run", () => {
    const h = archiveHealth({
      ...base,
      lastOkAt: new Date().toISOString(),
      lastCompleteAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    });
    expect(h.ok).toBe(true);
  });

  // ⚠️ The one outcome that looks exactly like success: a pass that completed
  // without reading the whole window.
  it("is not ok when the window was only partly read", () => {
    const h = archiveHealth({ ...base, lastTruncated: true });
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/page ceiling/i);
  });

  // ⚠️ Worse than a failed fetch: voicemail saved perfectly and none of it
  // playable. Ranked ahead of the failed count for that reason.
  it("is not ok when nothing can be served back", () => {
    const h = archiveHealth({ ...base, presignOk: false, failed: 3 });
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/cannot be served/i);
  });

  it("is not ok when something is parked as failed", () => {
    const h = archiveHealth({ ...base, failed: 2 });
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/could not fetch/i);
  });

  // ⚠️⚠️ A BACKFILL LOOKS EXACTLY LIKE A BACKLOG. Paging for one is how a
  // monitor teaches everybody to swipe it away, and the next alert is real.
  it("stays ok during a backlog, and exposes its age instead", () => {
    const h = archiveHealth({
      ...base,
      pending: 900,
      oldestPendingAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
    });
    expect(h.ok).toBe(true);
    expect(h.oldestPendingHours).toBe(5);
  });

  // ⚠️ Transcription may simply be off on this account, so zero is the expected
  // reading — reported so the other explanation (the fetch is broken) is
  // visible, never treated as a defect.
  it("reports zero transcripts without calling it a fault", () => {
    const h = archiveHealth({ ...base, transcripts: 0 });
    expect(h.ok).toBe(true);
    expect(h.transcripts).toBe(0);
  });

  // ⚠️ null is "nothing stored yet, so nothing to sign" — a fresh archive, not
  // a broken one. Only an explicit false is a fault.
  it("treats an unknown presign verdict as not-yet-known", () => {
    expect(archiveHealth({ ...base, presignOk: null }).ok).toBe(true);
    expect(archiveHealth({ ...base, presignOk: undefined }).presignOk).toBeNull();
  });

  it("never reports a number or a message id", () => {
    const json = JSON.stringify(
      archiveHealth({ ...base, oldest: "2026-08-20T00:00:00.000Z", newest: "2026-09-21T00:00:00.000Z" }),
    );
    expect(json).not.toMatch(/555555/);
    expect(json).not.toMatch(/9001/);
  });
});

describe("the module keeps its promises", () => {
  const src = gatewaySrc("voicemailArchive.mjs");

  // ⚠️⚠️ PHI lives on the MESSAGING pool, never the audit pool. Registering
  // from index.mjs would put a patient's recorded voice in the database whose
  // whole property is that it holds none.
  it("is registered from messaging.mjs and nowhere else", () => {
    expect(gatewaySrc("messaging.mjs")).toMatch(/registerVoicemailArchive\(\{ app, pool, requireCaller \}\)/);
    expect(gatewaySrc("index.mjs")).not.toMatch(/registerVoicemailArchive/);
  });

  // ⚠️ The MULTI-value messageType syntax 400s on this account (it broke the
  // whole thread load when it was tried), which is why smsArchive filters in
  // code. ONE value is proven in production by the SPA's fetchVoicemails.
  it("filters the store to voicemail with a single messageType value", () => {
    expect(src).toMatch(/messageType=VoiceMail&/);
    expect(src).not.toMatch(/messageType=VoiceMail,/);
  });

  // ⚠️ This API defaults to roughly the last 24 hours, so an omitted bound
  // quietly turns a 35-day repair pass into a one-day one.
  it("always bounds the read with an explicit dateFrom", () => {
    expect(src).toMatch(/dateFrom=\$\{encodeURIComponent\(dateFrom\)\}/);
  });

  // ⚠️⚠️ The scan may only ever move `none` → `pending`. Anything else and a
  // re-scan either re-downloads a stored recording forever, or erases the fact
  // that we hold one.
  it("never lets the scan overwrite a state the downloader owns", () => {
    expect(src).toMatch(/audio_state\s*=\s*CASE/);
    expect(src).toMatch(/voicemail_archive\.audio_state = 'none' AND EXCLUDED\.audio_state = 'pending'/);
    expect(src).toMatch(/ELSE voicemail_archive\.audio_state/);
  });

  // ⚠️ The health read must exclude clipped and shed passes, or the rule above
  // has nothing honest to measure.
  it("asks Postgres for the last COMPLETE pass, not just the last ok one", () => {
    expect(src).toMatch(/WHERE ok AND NOT truncated AND NOT shed/);
    expect(src).toMatch(/lastCompleteAt: r\.last_complete/);
  });

  // ⚠️ OLDEST FIRST. The oldest unarchived voicemail is the one closest to
  // deletion, so this is what makes the job race the window.
  it("drains oldest-first", () => {
    expect(src).toMatch(/ORDER BY created_at ASC/);
  });

  // ⚠️ The object must be written BEFORE the row is marked stored. The other
  // order marks a voicemail safe that is not in the bucket.
  it("writes the object before it claims to have stored it", () => {
    // ⚠️ Scoped to the drain's own body, not the whole file: `audio_state =
    // 'stored'` also appears in the presign self-check's SELECT, so a
    // file-wide search finds a later occurrence and passes even when the
    // ordering inside the drain has been inverted. (Checked by inverting it.)
    const start = src.indexOf("export async function drainAudioQueue");
    const end = src.indexOf("export async function drainTranscriptQueue");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const fn = src.slice(start, end);
    const put = fn.indexOf("await putObject(");
    const mark = fn.indexOf("audio_state = 'stored'");
    expect(put).toBeGreaterThan(0);
    expect(mark).toBeGreaterThan(put);
    // And exactly once each, so a second write cannot sneak in ahead of it.
    expect(fn.split("await putObject(").length - 1).toBe(1);
    expect(fn.split("audio_state = 'stored'").length - 1).toBe(1);
  });

  // ⚠️ A 200 is not audio — RingCentral's storage can hand back an XML error
  // body with a 200, and storing that loses the voicemail AND reports success.
  it("refuses a 200 that is not audio", () => {
    expect(src).toMatch(/\/\^audio\\\/\/i\.test\(contentType\)/);
  });

  // ⚠️ A throttle says nothing about this voicemail. Counting it would let one
  // busy afternoon park good messages as `failed`, which is terminal.
  it("never burns an attempt on a 429", () => {
    expect(src).toMatch(/up\.status === 429/);
    expect(src).toMatch(/stats\.audioTried--/);
  });

  // ⚠️ Every presigned URL is a bearer credential for PHI, so every issuance is
  // recorded. An untracked one is indistinguishable from a leak.
  it("audits every handout of the audio", () => {
    expect(src).toMatch(/INSERT INTO voicemail_archive_access/);
  });

  // ⚠️ Flipping the kill switch during an incident must not make the health
  // route 404, which a monitor reports as a fresh outage.
  it("keeps answering the health route when switched off", () => {
    const killIdx = src.indexOf("VOICEMAIL_ARCHIVE_ENABLED");
    const healthIdx = src.indexOf('app.get("/voicemail/archive-health"');
    const returnIdx = src.indexOf("    return;\n  }\n  if (!storeConfigured())");
    expect(killIdx).toBeGreaterThan(0);
    expect(healthIdx).toBeGreaterThan(killIdx);
    expect(healthIdx).toBeLessThan(returnIdx);
  });

  // ⚠️ `running` only blocks CONCURRENT runs, so a client posting again each
  // time the last finishes gets a full scan every time — the 2026-08-20 shape.
  it("rate-floors the forced run as well as authenticating it", () => {
    expect(src).toMatch(/FORCE_MIN_GAP_MS/);
    expect(src).toMatch(/lastForcedAt = Date\.now\(\)/);
  });

  // ⚠️ SigV4 signs the METHOD, so a URL signed from a GetObjectCommand is a
  // GET-only URL and a HEAD to it is SignatureDoesNotMatch every time. The call
  // archive shipped that bug and reported a false alarm on the one signal that
  // exists to be trusted.
  it("self-checks serving with a ranged GET, never a HEAD", () => {
    expect(src).toMatch(/method: "GET", headers: \{ Range: "bytes=0-0" \}/);
  });

  // ⚠️ A transcript may not exist at all on this account. Nothing may mark a
  // row failed for want of one.
  it("never lets a missing transcript fail a row", () => {
    const start = src.indexOf("export async function drainTranscriptQueue");
    const end = src.indexOf("let running = false;");
    const fn = src.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(fn).not.toMatch(/audio_state/);
    expect(fn).not.toMatch(/audioFailed/);
  });
});
