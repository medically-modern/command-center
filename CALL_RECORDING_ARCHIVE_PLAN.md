# Call recording archive — plan (Sep 2026)

Josh, 2026-09-21: *"RC saves recorded calls for 10 days then deletes them. we cant have that.
we need a simple system that saves and downloads the calls everyday. can we save on railway so
CC can always access these? itll end up being a hefty amount of files, whats the best system?"*

**Short answer:** yes — a new `callArchive` module inside the existing **`cmd ctr server`**
gateway, audio into a **Railway Storage Bucket**, an index row per recording in the **messaging
Postgres**, and the Command Center's existing Play / ⤓ buttons served from the archive once
RingCentral has dropped the file. It is `smsArchive.mjs` (§5.27) with bytes instead of text, and
it should be built the same way for the same reasons.

**The file count is the scary number and the storage bill is not.** ~17,000 recordings a year,
but **under $1/month of storage in year one and under $5/month even at seven years of retention**
(§3). The real constraints are RingCentral's download rate limit, the join key, and the fact that
this is the most sensitive artifact we would have ever stored.

---

## 1. ⚠️ First: 10 days or 90? It changes the urgency, not the design

**I could not verify the 10 days from this session and I am not going to guess at it.** Two
things point the other way and one points at you being right:

| Source | Says |
|---|---|
| This repo's own live measurement, 2026-09-16 (`recordingDownload.ts`, §5.16) | **90 days.** A cliff, not a slope: 88–90 days ago **9/9** connected calls still had audio, 90–92 days ago **0/126** did |
| RingCentral's published policy + their archival guide | **90 days** or 100,000 recordings, whichever comes first; not raisable on any plan |
| You, today | **10 days** |

Three ways all three can be true at once, and they are worth ruling out in this order:

1. **Somebody shortened it in the admin console.** RingEX admins can set a *shorter* account
   data-retention policy than the 90-day default. That is the one explanation that makes 10 days
   real, and it is a two-click check.
2. **It is a different clock.** RingCentral's *message store* — voicemail, fax, SMS — is a
   ~30-day window on this account (measured 2026-09-01, §5.27), and the RingCentral desktop app
   caches locally on its own schedule. If what you saw was a voicemail disappearing, that is a
   real and separate problem (§7).
3. **The measurement is five days stale** and the policy changed between 09-16 and today.

⚠️ **If it really is 10 days, then roughly 80 days of recordings this repo believed were safe
are already destroyed** — about 5,500 calls — and that is unrecoverable no matter what we build.
That is the whole reason to settle this before writing code rather than after.

**How to settle it, in order of cost:**
- **Admin console** → Phone System → Auto-Receptionist / Account settings → *Data retention*.
  Look for a recording retention value under 90 days. Thirty seconds.
- **Or measure it**, the same way §5.16 did: pull the call log for a day 15, 30 and 60 days back
  and count how many connected calls still carry a `recording` object. Nine of nine at 60 days
  means 90; zero at 15 days means 10. This needs a RingCentral credential, which lives only on
  the gateway (`cmd ctr server` env) — **it is deliberately not in this repo and not in this
  session**, so it is a five-minute job for whoever has that, not something I can run from here.

**Either way the architecture below is identical.** What the answer changes is exactly two
numbers, both config vars, and one judgement:

| | 10 days | 90 days |
|---|---|---|
| Backfill size | ~690 recordings, **~1.5 h** | ~6,200 recordings, **~10 h** (one night) |
| `CALL_ARCHIVE_WINDOW_DAYS` | 12 | 95 |
| Tolerable consecutive failed runs | **~9** before permanent loss | ~89 |
| Alert posture | a *single* missed day is worth a push | a missed week is worth a push |

⚠️ And the framing that does not depend on the answer: **every day this is not running costs
~69 recordings permanently.** Nothing recovers them later.

---

## 2. Where it lives, and why it cannot be a separate service

**It goes in `services/monday-gateway/` as `callArchive.mjs` + `callArchiveRules.mjs`** (the pure
half, unit-tested), the same split as `callRules` / `smsArchiveRules` / `callHistoryQuery`.

The obvious alternative — a new Railway cron service beside `baseline-cron` and `calls-monitor` —
is **wrong for one specific, decisive reason**:

> ⚠️⚠️ **`rcLimiter` is an in-memory, in-process budget.** It governs RingCentral at 40
> requests/caller/60s against a global 90, and sheds `background` work above 70% of that
> (`rcLimiter.mjs`). A second service calling RingCentral **cannot see that counter and cannot be
> restrained by it** — so a nightly archive job in its own container would spend the shared
> account's budget invisibly, right next to the fax poller, the inbox poll and every rep's live
> thread. That is INCIDENT_2026-08-20 with a cron on it: one runaway consumer took texting, the
> fax count and the call log down **for test and prod at once**, because there is one RingCentral
> app behind both (§8).

Running inside the gateway means the archive competes for the same in-process budget as
everything else, on the `background` tier, and gets shed first when reps are working. That is the
correct priority and it is free.

Secondary reasons, all pointing the same way: the RC credentials, `rcApiFetch`, the messaging
pool and the health-route convention are all already there; `calls-monitor` already polls the
gateway every 10 minutes; and a second copy of the RC credential is the §5.7/§5.17/§5.29
hand-synced-mirror hazard applied to a secret.

⚠️ The gateway redeploys on every push to `main`, so a 10-hour backfill **will** be interrupted.
That is fine by construction — see the reconcile rule below — but it is why the backfill must be
resumable rather than a one-shot script.

---

## 3. Storage: Railway Storage Bucket. The numbers.

Railway shipped S3-compatible **Storage Buckets** (private, encrypted at rest, on Tigris). The
project has none today (`buckets: []` on `handsome-simplicity` / production, checked today).

**Pricing, from Railway's docs:** **$0.015 per GB-month**, with **all S3 API operations and all
bucket egress free**. Service egress (the gateway *uploading* to the bucket, and any bytes it
serves to a browser) is billed at **$0.05/GB**.

### What it actually costs

Measured inputs (§5.16, live audit 2026-09-16): **~69 recorded calls and ~5.6 hours of audio per
business day**; 760/774 connected calls were recorded, so auto-recording is on for everything.
That is **~1,400 recordings/month, ~17,250/year.**

⚠️ **The bitrate is the one number I do not have.** RingCentral does not publish it and this
session cannot fetch a file to weigh one. So the table is a bracket, not a measurement — the
first archived file settles it to a real figure:

| MP3 bitrate (mono) | Per business day | Per year | Stored cost @ 5 yrs | @ 7 yrs |
|---|---|---|---|---|
| 16 kbps | 40 MB | 10 GB | $0.76/mo | $1.06/mo |
| **32 kbps** (most likely for 8 kHz telephony) | **81 MB** | **20 GB** | **$1.51/mo** | **$2.12/mo** |
| 64 kbps | 161 MB | 40 GB | $3.02/mo | $4.23/mo |
| 128 kbps | 323 MB | 81 GB | $6.05/mo | $8.47/mo |

**So: "a hefty amount of files" is true in count and false in cost.** Keeping every call
forever, at the pessimistic end of that bracket, is under $10/month. Upload egress is a one-off
~$0.25–$0.50 for the backfill and ~$1–2/year thereafter. The Postgres index is 17k rows/year —
nothing.

⚠️ **Do not design a deletion policy to save money; there is no money to save.** If recordings
are ever pruned it should be because a retention *policy* says to, not because of the bill. The
default should be **keep everything**, like `call_events` (§5.13) — an archive that deletes the
evidence somebody came looking for is worse than a big one.

### The options that were considered and rejected

| | Verdict |
|---|---|
| **Railway Storage Bucket** | ✅ **Recommended.** S3-compatible so any client works; free ops and free bucket egress; reachable from any service in the project, independent of the gateway's lifecycle; encrypted at rest; per-environment isolation so a test env cannot touch prod objects. Region **`sjc`** — the services run in `us-west2`, and `sjc` is the nearest of the four (`sjc`/`iad`/`ams`/`sin`). |
| **Railway Volume** on the gateway | ❌ Mounts to exactly one service, so nothing else in the project can ever read it; no presigned access; backup is entirely our problem; and it ties a growing pile of PHI to one container's lifecycle. Volumes here are provisioned at 50 GB, which a 128 kbps year would eat. |
| **Postgres bytea in `cmd ctr db`** | ❌ Tens of GB of audio in the same database as the audit log and the send queue. Bloats every backup, and Postgres is the wrong tool for blobs. |
| **Cloudflare R2 / AWS S3** | ❌ Same storage price as Railway (R2) or worse (S3), plus another vendor, another credential, another BAA conversation. No benefit at this volume. |
| **RingCentral Archiver** (their built-in export to Dropbox / Google Drive / Box / SFTP) | ❌ Considered seriously, because it is zero code. Rejected: it drops files in a folder with **no index the Command Center can join to a call id or a patient**, so the Play button on a 6-month-old call still does nothing and a rep still cannot find the call they need. It solves "the bytes exist somewhere"; the ask is "CC can always access these". Worth keeping in a back pocket as a belt-and-braces second copy. |

⚠️ Two Railway bucket facts worth knowing up front: there is **no lifecycle configuration and no
object versioning** yet (so retention pruning, if ever wanted, is our own job), and **no
automatic backups** — a deleted bucket is restorable for 52 hours and then gone for good.

---

## 4. ⚠️⚠️ The join key — the one thing that is easy to get wrong and fatal

**Key the archive on the CALL, not on the recording.**

After the purge, the call-log **row survives** and carries its `id` and `sessionId`; the
`recording: { id, contentUri }` object **disappears from it entirely**. That is precisely why
§5.16 records that an aged-out call "renders exactly like one that was never recorded".

So an archive keyed only on `rc_recording_id` is **unjoinable to the surviving row the moment it
becomes useful.** The index must carry, at minimum:

- `rc_call_id` (the call-log record id) — **the join key a surviving row still has**
- `rc_session_id` — RingCentral's telephony session, which also survives and is what `call_events`
  (§5.13) already keys on, so the archive can be joined to the ring/claim audit
- `rc_recording_id` — the idempotency key for the upload itself
- **the call metadata too**: direction, start time, duration, result, and the counterparty as
  **HMAC + last4** (never in the clear — the same call `sent_messages`, `call_events`,
  `sms_archive` and `patient_directory` all make)

⚠️ **Store the metadata even though RingCentral has it today.** The call log ages out on its own
schedule and the archive has to be able to answer "what was this recording" from itself. It costs
a few hundred bytes per row against a multi-megabyte object.

Object key: `recordings/<YYYY>/<MM>/<DD>/<rc_call_id>_<rc_recording_id>.<ext>` — date-partitioned
so a prefix listing is a day's calls, and the two ids in the name so an object found loose in a
bucket explorer still identifies itself.

⚠️ The extension comes from the response's own content type, never assumed — recordings are MP3
on most accounts and WAV on some, **per account**, and `extensionFor()` in
`src/lib/callHistory/recordingDownload.ts` already encodes exactly this lesson. Reuse the rule.

---

## 5. The job

**Reconcile, never increment** — the rule `smsArchive.mjs` states at the top and the
call-subscription reconcile (§5.13) states again. Each run re-reads the whole window from the
call log and uploads anything not already in the index.

> That is what makes **any single successful run repair every prior gap**: a week of failures
> costs nothing so long as one run lands before the oldest unsaved recording ages out. An
> incremental "everything since my last cursor" design turns one bad run into a permanent hole —
> and this gateway redeploys on every push to `main`, so bad runs are a certainty, not a
> hypothetical.

**Cadence: daily, plus a boot run** skipped if one succeeded within
`CALL_ARCHIVE_MIN_GAP_HOURS` (6) — so an afternoon of deploys does not re-scan each time.

⚠️ **If retention really is 10 days, run it twice a day** (`CALL_ARCHIVE_EVERY_HOURS=12`). A
10-day window at daily cadence leaves nine days of slack, which is enough — but the slack is what
you are buying, it costs nothing, and the failure is silent.

### ⚠️ Pacing: RingCentral's Heavy group is 10 requests / 60 seconds

RingCentral's own archival guide puts **call recording access in the Heavy API group — 10
requests per 60 seconds**, four times tighter than the gateway's own per-caller budget of 40. So:

- `RECORDING_GAP_MS = 6_500` (≈9/min), not the SPA's `DEFAULT_GAP_MS = 2_500`.
- Every fetch on the **`background`** tier, so a rep's interactive work sheds it first.
- On a `429`, honour `Retry-After`, back off, and **carry on** — a batch abandoned over one file
  leaves the rest of the day unarchived.
- Read the **`X-Rate-Limit-Group`** response header and log it. RingCentral's recordings guide
  tells you to; it is the only authoritative statement of which group this endpoint is in, and
  it settles the gap constant with a fact instead of a doc page.

> ⚠️ **Related finding, worth fixing while in here:** the SPA's bulk "Download all" paces at
> 2.5s ≈ 24/min (`recordingDownload.ts`), which is **above** the Heavy group's 10/min if that
> classification is right. A rep downloading a day of calls is probably already being throttled
> and silently eating the one built-in retry. Same header settles it.

**Time to run:** daily incremental of ~69 recordings ≈ **8 minutes**. Backfill: **~1.5 h** for a
10-day window, **~10 h** for 90 — overnight, resumable, and interruptible for free.

### What gets archived

Every call-log record that carries a recording, in either direction. Not just patient calls —
the filtering is a display question and the cost of keeping everything is noise.

⚠️ **Absence is not evidence.** A connected call with no `recording` inside the retention window
means it was never recorded; a call *outside* the window with no recording means nothing at all.
The job must never write a "no recording exists" marker that a later reader could mistake for a
fact — the same rule `patientDirectory`'s `isOrphanRow` and the pending-advance marker (§9) both
follow: act on positive evidence, let absence mean nothing.

---

## 6. Serving it back to the Command Center

**`GET /calls/recording?callId=…` on the gateway, authenticated with `requireCaller`, streaming
the bytes from the bucket.**

⚠️ **Proxy the bytes; do not hand the browser a presigned URL.** Presigned URLs are the cheaper
pattern and Railway recommends them — but a presigned URL to a call recording is a **bearer
credential for PHI**, copyable out of a browser's network tab and shareable by anyone who has it,
for as long as it lives. Proxying keeps every byte behind the signed-in employee check that
`/calls/history` already uses. The cost of that choice is service egress at $0.05/GB on bytes
reps actually listen to — a few dollars a year at this volume. It is the right trade and it is
the only place in this plan where the expensive option is the correct one.

**Two changes on the SPA side**, both small:

1. `fetchRecordingBlob` falls back to the archive route when RingCentral 404s — so Play and ⤓
   keep working on a call past the purge with no other change.
2. ⚠️ **The buttons have to appear at all.** Today an aged-out call renders with no Play button
   because the call-log row carries no `recording` — so a fallback alone fixes nothing a rep can
   see. `CallHistoryButton` and the Comms Hub Phone tab need **one batched lookup** —
   `POST /calls/recordings/have` with the call ids on screen, answering which ones we hold — in
   exactly the shape `useDirectoryNames` (§5.28) already uses: one request per list, module-scope
   cache, misses cached, **failures not cached**, stable returned identity (incident rule 2).

That second one is what actually delivers "CC can always access these", and it is the half that
is easy to leave out and then not notice, because the failure looks exactly like the status quo.

---

## 7. ⚠️ Voicemail audio is on a tighter clock and is not covered by any of this

RingCentral's **message store is ~30 days** on this account (measured 2026-09-01, §5.27) —
voicemail audio, fax images and MMS photos all live there, and all of them age out three times
faster than a call recording does.

`smsArchive` copies the **text** of a message and deliberately stores MMS attachment metadata
only: "*a patient's insurance-card photo is recorded as having existed, not saved*". Voicemail
audio has no archive at all. Volume is far smaller than call recordings, the module is the same
module, and the storage is the same bucket.

**Recommendation: include voicemail audio in phase 2**, as `voicemails/<date>/<id>.mp3` in the
same bucket with rows in the same table (`kind: 'recording' | 'voicemail'`). ⚠️ But if what you
actually saw disappearing at 10 days was a **voicemail**, this is not phase 2, it is phase 1 —
which is the other reason §1 is worth settling first.

Not in scope, flagged: MMS photos and inbound fax images, same 30-day window, same bucket would
serve. Separate decision.

---

## 8. ⚠️ This is the most sensitive thing we would have ever stored

The gateway's standing posture is metadata-only (`LOG_PAYLOAD=false`; `gql_log` and
`request_log` keep no bodies and strip query strings, §8). Two departures have already been taken
**explicitly rather than arrived at** — `sms_archive` message bodies (§5.27) and
`patient_directory` patient names (§5.29) — each bounded the same two ways: the **messaging pool,
never the audit pool**, and numbers as **HMAC + last4, never in the clear**.

**A call recording is a step beyond both.** It is a patient's actual voice discussing their
actual medical condition — biometric identifier and PHI in one artifact, and unlike a text it
cannot be redacted or truncated.

The same two bounds apply and are not optional:
- ⚠️ Index rows on the **messaging pool** (`ASSIGNMENTS_DATABASE_URL`), never the audit pool —
  that DB keeps its no-PHI property. **Do not move this table.**
- ⚠️ Counterparty as **HMAC + last4**. The object key carries call ids, never a phone number, and
  **never a patient name** — unlike the download filename, which is for a human's folder.

Three things that need your explicit call before this ships, not after:

1. **The decision itself**, on the record, the way §5.27 and §5.29 are. This doc is where it goes.
2. **BAA coverage.** Railway Postgres already holds PHI under whatever arrangement covers that;
   buckets run on **Tigris**, a subcontractor. Whether the existing coverage extends is a
   question for Railway, and it is worth asking before 20 GB of patient voice is sitting there.
   ⚠️ Not a blocker I should decide — a question I should not answer by assuming.
3. **Retention.** The default in this plan is keep-forever, because the bill does not argue
   otherwise. If a records policy says seven years, that is a prune job and a config var; if it
   says something shorter, the archive is still worth building, it just has a floor.

Also worth noting plainly: an archive makes recordings **more** discoverable than RingCentral's
90 days ever did. That is the point, and it is also a fact a compliance conversation should know.

---

## 9. Watch it, or it fails silently

Every failure here looks exactly like a quiet afternoon — the same property that made
`/calls/health`, `/messaging/archive-health` and `/directory/health` necessary (§5.13, §5.27,
§5.29).

**`GET /calls/archive-health`** — unauthenticated, **counts and timestamps only, never a number,
a name or a call id**, matching the posture of the three beside it. Reports
`ok / stale / truncated / lastOkAt / rows / bytes / oldest / newest / lastRunSkipped`.

⚠️ **Not ok when no run has ever succeeded**, however many rows the table holds — a job deployed
but never actually running must not read healthy. ⚠️ **Not ok when the last good run was
truncated** (hit `MAX_PAGES`): a pass that completed without reading the whole window is the one
outcome that looks exactly like success while the recordings it never reached age out. That exact
bug shipped in `smsArchive` and was caught in review; do not re-ship it.

**Point `services/calls-monitor` at it** — it already runs `*/10 * * * *` from this repo and
already pushes to ntfy, so this is one more `faults()` clause and its tests. ⚠️ `faults()` is pure
and tested for a reason: an alert that stays quiet during an outage is worse than none, because
it reads as an all-clear.

⚠️ **Staleness threshold follows §1.** At 90-day retention, "stale" is a few days. At 10 days,
**stale is 36 hours** and it should page.

`POST /calls/archive-run` forces a pass — **authenticated AND rate-floored**
(`CALL_ARCHIVE_FORCE_MIN_GAP_MINUTES`, 5), both, for the reason `smsArchive` records: `running`
blocks only *concurrent* runs, so a client that posts again each time the last one finishes gets
a fresh full scan every time. The 2026-08-20 incident was a runaway **authenticated** client;
auth alone would not have stopped it.

`CALL_ARCHIVE_ENABLED=0` kills the whole thing from Railway without a revert.

---

## 10. Build order

**Phase 0 — settle the retention question (§1).** Half an hour. Everything downstream is sized
by the answer, and if it is 10 days the urgency changes.

**Phase 1 — the bucket.** Create it in `handsome-simplicity` / production, region `sjc`, and
wire its credentials into `cmd ctr server` by variable reference. No code.

**Phase 2 — the archiver.** `callArchiveRules.mjs` (pure: window, object key, row shape, health
verdict, what counts as archivable) + tests first; then `callArchive.mjs` (the reconcile, the
upload, the schema, the two routes) and its registration in `index.mjs`. Ship it **disabled**,
enable it for one day, read `/calls/archive-health`, then leave it on.

**Phase 3 — the backfill.** Same function, a wider window, run overnight. Resumable by
construction. ⚠️ Whatever §1 says the window is, run this **first** and the same night —
everything older than it is already gone and everything inside it is on a clock.

**Phase 4 — serving.** The gateway route, the SPA fallback, and the batched "do we have audio for
these calls" lookup. This is the phase a rep can see.

**Phase 5 — voicemail audio** (§7), or earlier if §1 turns out to be about voicemail.

**Phase 6 — the monitor clause** in `calls-monitor`, and this doc folded into `CLAUDE.md` as a
new section with its keep-in-agreement list.

---

## 11. Keep-in-agreement (for when this is built)

- `callArchiveRules.mjs` `WINDOW_DAYS` ⇄ the real RingCentral retention (§1) ⇄
  `/calls/archive-health`'s staleness threshold ⇄ `calls-monitor`'s `faults()` clause. A window
  shorter than retention loses recordings **silently**.
- `RECORDING_GAP_MS` ⇄ the `X-Rate-Limit-Group` the endpoint actually reports ⇄
  `src/lib/callHistory/recordingDownload.ts` `DEFAULT_GAP_MS`. Two different opinions about
  RingCentral's budget in one codebase is how one of them starts getting throttled.
- `extensionFor()` — one copy, shared between the archiver and the SPA downloader. Per-account
  MP3-vs-WAV is exactly the thing a second copy gets wrong.
- The index table stays on **`ASSIGNMENTS_DATABASE_URL`** (§8). `phoneHash.mjs` is the only
  hasher; the object key never carries a number or a name.
- The archive is keyed on **`rc_call_id`**, not the recording id (§4) — pin it in a test, because
  the failure only appears once a recording has already been purged, which is months after the
  code shipped and looks like the feature was never built.
