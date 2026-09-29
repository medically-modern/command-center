## 10. Known risks / open items (don't rediscover these)

- **Secrets in the public bundle — ONE is left, and this entry was two-thirds stale until
  2026-09-23.** Re-measured that day: **`VITE_MONDAY_API_TOKEN` still ships** and is the only one
  (`shared/mondayEndpoint.ts:83`), as the **direct-mode fallback** — with `VITE_MONDAY_GATEWAY_URL`
  set it is never read, so a production build that omits it is the fix ("Phase 1b"). The other two
  are DONE and must not be re-done:
  ✅ **RingCentral** — the client secret and JWT left the bundle; every call goes through the
  gateway's `/rc/<path>`, which holds them server-side (`lib/fax/ringcentralApi.ts` says so in its
  header). The only RC value in `src/` is `VITE_RC_SMS_FROM`, the company's own published number.
  **Do not go rotating an "exposed" RC credential — it is not in the bundle.**
  ✅ **`VITE_GITHUB_PAT`** — gone from `src/` entirely. `access.json` now reads and writes through
  the Cloudflare worker's `/gh-state`, which injects `env.GITHUB_PAT` server-side against an
  allowlisted repo+file (`worker/src/index.js:389`).
  ⚠️ §5.3's "bundled `VITE_GITHUB_PAT`" and §5.1's direct-mode note read as though all three
  still ship; only the Monday one does.
- ✅ **Audit finding H6 is FIXED — the Subscription send IS verified** (confirmed 2026-09-23).
  `lib/subscription/mondayWrite.ts:215` runs the whole ~20-column write through
  `executeWritesWithVerification` with `stageColumnId: []` (this board has no advancer, so Phase 3
  writes nothing and every task is read-back verified), and throws on any failed column rather than
  firing confetti. Routing through `verifiedWrite` is also what lets the gateway's `/send` fast path
  collapse it into ONE `change_multiple_column_values`, which Monday requires — it rejects
  concurrent mutations against one item. The code carries the same note by name. **Nothing to do
  here; this bullet said otherwise for months.**
- **Inline write ordering** in SendRequest/ConfirmReceipt/Chase panels and the **Escalation modal**
  (audit H1–H5, M2) can flip a trigger before sibling data is indexed.
- **"Never billed" attestations** can't be un-set from the UI (code only writes when truthy).
- **Split-order duplicate** (Final Confirm) races a Monday "new item created" automation; the code
  re-writes flags "defensively" afterward (audit M6).
- **Monday long-text columns hold 2000 chars and TRUNCATE SILENTLY** (found 2026-08-14 while
  repairing three patients). A `change_column_value` / `change_multiple_column_values` write with a
  longer body returns **success** and stores only the FIRST 2000 characters — no error, nothing in
  the response. Because every notes column here is append-only (history first, newest last), what
  gets dropped is always the note somebody just wrote. ⚠️ The all-or-nothing property of
  `change_multiple_column_values` does NOT help: it guarantees the transaction doesn't half-apply,
  not that the value is stored in full. A scan of the ME board found **9 items already sitting at exactly 2000** (11 by 2026-09-03 — see below) — every note appended to those is being thrown away. ⚠️ **Worst case is
  Doctor Appointments**, where the attempt LINES in MN Workflow Notes *are* the counter
  (`apptAttemptsFromNotes`): truncation drops the newest lines, so the counter freezes, the rep gets
  unlimited retries and the third-attempt escalation never fires. `lib/shared/longText.ts`
  (`assertLongTextFits`) now makes the big-append paths fail LOUDLY instead — the four masheke
  appointment/chase writers, `returnProposedToQueue` (both branches) and `EvaluatePanel`'s re-eval
  **Guarded 2026-09-03 — every live NotesPanel** (masheke incl. its two edit-mode saves · samantha ·
  finalConfirm · welcomeCall · subscription) now refuses through
  `components/shared/longTextGuard.refuseLongTextOverflow` BEFORE the optimistic overlay and before
  clearing the box, so the rep's text survives to be shortened and the toast names the column and
  the overflow. Until then "Add" wrote straight through: green **"Note saved to Monday"**, note on
  screen, note gone from the board. Same day, `EvaluatePanel`'s send-time `assertLongTextFits` moved
  INSIDE its try — it threw outside every catch, so a full notes column produced no toast and a Send
  button stuck in its spinner; Bridget Browne (`12604305734`) sat like that 2026-08-28 → 09-02 with
  **zero** board writes while "it kept saving" (§11).
  ⚠️ **Refusing is a HARD BLOCK on a full column — and the population is not small.** Scan
  2026-09-03 (gateway `/gql`, lengths only, never bodies): **ME 11 at exactly 2000 (3 in 2. Medical
  Necessity) · Insurance 18 (13 ACTIVE: 3 Benefits, 1 Submit Auth, 7 Auth Outstanding, 2 Auth
  Denied) · Welcome Call 8 (all Completed) · Subscription 0 — 37 items, 16 in live stages**, up from
  9 on 2026-08-14. Those 16 now get a red *"N characters over"* on Add instead of silent loss, until
  their history is moved. Repair in THIS order: create the item **update** holding the full body,
  confirm it landed, THEN trim the column — never trim first. Trimming also moves a parser's input:
  Doctor Appointments counts attempt lines after the last reset marker (§5.12), so that marker must
  stay in the column.
  **Still unguarded (same silent loss; each sits inside a transaction or a stamp and needs its own
  reading, not a blanket guard):** the attempt-save MN-notes task in `ChaseClinicalsPanel` and
  `ConfirmReceiptPanel`, `SendRequestPanel`'s fire-and-forget append, both Propose Stuck stamps
  (`masheke/ProposeStuckModal`, `samantha/ProposeStuckButton` — a refusal there must not leave the
  escalation half-raised), the notes task in `samantha/mondayWrite`, `finalConfirm/mondayWrite` and
  `subscription/mondayWrite`, `FinalConfirmPage`'s FPC-override stamp, and the Request Body writes
  (`long_text_mm4cnw52`, Chase + Confirm Receipt). `profile/unverifiedWrite.appendIntakeNote` is
  deliberately NOT guarded — `text_mm389fs` is a plain `text` column with no 2000 cap (§5.28).
  Detect-and-refuse only (Josh, 2026-08-14) — trimming old history to make room is the same harm,
  just chosen by us. The escape hatch for a body that genuinely no longer fits is a Monday
  **item update**, which has no limit.
- **The 2000 cap is being REMOVED by converting the notes columns to plain `text`** (decision: Josh,
  2026-09-03). Monday's own docs: long_text *"accepts up to 2,000 characters"*; text has *"no fixed
  character limit"* (~64KB per item, all columns together). Profile Send Off Notes `text_mm389fs` has
  been a `text` column all along — 2,635 items, 15 over 2,000, longest 9,383, **none** piled at 2,000
  — which is why it is the one notes column with no truncation history. Sandbox-verified the same day
  (throwaway board `18429581848`): 4,782 chars stored intact in a text column, the same body cut to
  2,000 in long_text; a hop into a text mirror preserved newlines on 174/240 Insurance items and
  mangled **0** dates (the §9 sniffing hits bare date tokens, not prose).
  **Columns to convert** (every app-appended long_text): ME `long_text_mm27zjt2` · Insurance
  `long_text_mm2ffsme`, `long_text_mm59y5xt` (Benefits Call Log), `long_text_mm59rz2c` (SoS/Auth Call
  Log) · Welcome Call `long_text_mm2ffsme` + its two capped mirrors `long_text_mm5g1txs`,
  `long_text_mm5gx6j6` (6 items already cut at 2,000 there) · Subscription `long_text_mm3rj7k7`.
  Optional: the four Escalation Notes, ME Request Message `long_text_mm4cnw52`. Notes do NOT hop into
  Subscription (workflow 7918317925 copies none), and WC's live Notes arrives **pre-seeded** by the hop
  (60/60 of the newest WC items), which is why WC fills fastest.
  ⚠️ **The conversion is a Monday-UI action** ("Change column type → Text → Keep changes"); the API has
  no type-change mutation (checked the Mutation schema). Monday says it *deletes and replaces* the
  column and does not say whether the **id survives** — being tested on the sandbox (Phase 0). If ids
  survive, the app's `COL` maps and the three hop workflows (7917676280 Profile→ME · 7918295320
  ME→Insurance · 7918324247 Insurance→WC, column→column variable pairs) need nothing; if not, re-point
  both. Either way, **never infer a column's type from its id prefix** again — `lib/shared/columnType`
  asks the board.
  **The app is already flip-safe (Phase 1, 2026-09-03)**, so the flips need no deploy and cannot strand
  prod (which shares the boards but lags test by a sync): every notes writer — the six role
  `writeLongText` helpers, the 17 verified-send payloads, the Comms Hub composer — sends a **bare
  string via `change_multiple_column_values`**, which Monday accepts for BOTH types.
  `change_column_value` does not: it rejects a bare string for long_text AND a `{text}` object for text
  (sandbox A/B/E), so it would break on flip day in one direction or the other. Only the 2,000
  **guard** needs the type, and it asks the live board — `columnType.isCappedColumn` (5-minute cache;
  unknown id / 503 / first paint ⇒ **capped**, the safe default) behind `assertTextLikeFits` and
  `longTextGuard.refuseLongTextOverflow(…, columnRef)`; every NotesPanel mount passes its
  `{boardId, columnId}`. `notesWriteShape.test.ts` fails the build if a writer drifts back to
  `change_column_value` + `{text}`. Once a column is text the refusal stops firing within five
  minutes on its own, and the 16 blocked patients need no repair.
  **Cut over 2026-09-03 → the new `text` columns:** ME `text_mm6vevjf` · Insurance `text_mm6vzc7q` · Welcome Call
  `text_mm6vqq2k` (Notes), `text_mm6v4fny` (MN mirror), `text_mm6vvsjy` (Profile mirror) · Subscription `text_mm6vp1z3`.
  Monday's UI conversion makes a NEW id (sandbox: `text_mm6vqvhz` beside `long_text_mm6vtxyh`), so the six were
  created beside the originals, copied with `scripts/notes-migration/migrateNotes.mjs` (1,591 items, 0 mismatches
  after the sweeps), the app re-pointed (74381d4, 2026-09-03 ~8 PM ET), and the long_text originals retitled
  **"(retired)"** — hiding them from the views is Josh's remaining click; they are NOT deleted. A 3,024-char text
  value crossed 7917676280 intact, so the mirrors carry full history from here on.
  ⚠️ **The two hop automations that copy notes — 7918295320 ME→Insurance · 7918324247 Insurance→WC — are
  board automations the workflow-builder API cannot load** (`validate_workflow` / `invoke_workflow_expert`
  answer "General error" for them while a freshly created workflow works), so their column mappings can only be
  changed in Monday's UI, by a person. Josh re-pointed them the next morning (2026-09-04, 10:01 and 10:08 ET);
  verified from fresh `list_automations` dumps (every notes pair on the new ids — `scripts/notes-migration`'s
  README says how) and by the first live hop after the edit (Insurance `12977325713`: MN mirror 141 chars =
  its ME source's `text_mm6vevjf`, the retired column 0). In the ~14 hours between the app cutover and that
  edit every hop copied the retired, now-frozen column, so the destination mirror arrived EMPTY —
  `scripts/notes-migration/backfillMirrors.mjs` filled the three Insurance items that hopped in the window
  (kept for the day a hop is ever pointed at a retired column again). ⚠️ 7918324247 still carries three rows
  writing the WC **"(retired)"** columns (Notes ← Insurance "Insurance Notes (retired)"; the MN / Profile
  mirrors ← Insurance `text_mm3xbvss` / `text_mm3xfw5a`) — harmless, nothing reads them, but clear those rows
  when hiding the columns or capped copies keep being written into columns nobody looks at.
  ⚠️ **Live-board changes like these are an OFF-HOURS job** (Josh, 2026-09-03 — these are active boards):
  sandbox first, then the columns, the copies and the hop workflows in one evening, then the lengths re-scan.
  Not during the day.
- ~~**Welcome Call + Final Confirm escalation is WRITE-ONLY, and those two stages need a REWRITE**~~
  **REWRITTEN 2026-09-14 — §5.34.** (Josh, 2026-08-14, from the escalation audit: `mondayMapping`
  hardcoded `escalated: false`, `mondayWrite` wrote index 0 only `if (p.escalated)` with no `→ Done`
  branch, so the sidebar and the burndown disagreed, the escalated filter was permanently empty,
  there were no Oversight charts and nothing could clear the flag.) Both stages now read the
  column by index, never write it from the send, run the Propose Stuck ladder, and have Manager
  Intervention / Final Decisions charts. The board half landed the same day: label id 2
  "Final Escalation Required" was added to `color_mm1x7997` and read back (§5.34 records how —
  a two-step colour swap, because Monday refuses duplicate colours and derives a new label's id
  from its colour), so both rungs work. The live-label guard stays.
- **Subscription's Escalate button never persists anything** (same audit). The mapping hardcodes
  `escalated: false`, `COL.authEscalation` (`color_mm2n237s`) is defined but **never written by
  `mondayWrite`**, and `toggleEscalate` only touches the local overlay — the button reverts on
  refetch. The board column has a **single label `Escalate` and no `Done`**, so it could not be
  cleared by index even if it were written. 36 items carry it, set outside the SPA. Left as-is
  deliberately.
- **A runaway React component can exhaust the shared RingCentral account** — it did, on
  2026-08-20, at ~1,166 req/sec from ONE browser, taking down texting, the fax count and
  the call log across **both test and prod** (one gateway, one RC app, §8). The gateway now
  has a limiter (`services/monday-gateway/rcLimiter.mjs`, §5.13) so the same shape can't
  reach RingCentral again, but the SPA still has no client-side guard. Full write-up:
  [`INCIDENT_2026-08-20_RINGCENTRAL.md`](../../INCIDENT_2026-08-20_RINGCENTRAL.md) — read rule 2
  there before putting a hook's return value in a dependency array.
  ⚠️ **The limiter's breaker is per RingCentral API group since 2026-09-29.** On 2026-09-28,
  19:30–23:00 ET, stedi-monday-integration's reorder contact stamping (every 15 min, 8am–11pm
  ET) sent ~20 call-log reads through `/rc` in ten seconds — twice the `heavy` group's ~10/min —
  and took a 429 every run. The breaker was one switch, so each 429 also refused reps' `light`
  message-store reads (texts, fax count) for the next minute, and the calls monitor's
  subscription probe with them. Now a 429 pauses only the group RingCentral names in
  `X-Rate-Limit-Group`, for as long as its `Retry-After` asks (up to `maxCooldownMs`, 60 min,
  `RC_MAX_COOLDOWN_MIN`; it was 15). `/calls/health` → `rcGuard.breakers` names the paused
  group, and each 429 logs its group, Retry-After and limit. ⚠️ `/rc` takes non-browser
  callers (CORS stops only browsers) and the per-caller budget (40/min) is four times the heavy
  group's allowance, so a server-side caller can still exhaust the call log for everyone; the
  gateway HTTP log's `srcIp` / `clientUa` is how to find it.
- **A completed patient can still be re-advanced from Patient Intake — KNOWN, deliberately left**
  (Josh, 2026-09-01: detection only for now). `UnverifiedReferralsPage` is the only intake-family
  page with no `useCompletedStageReview` / `reviewMode` gate, and `useMondayPatients` injects a
  deep-linked `?patientId=` into the sidebar **whatever group the item is in** — so an item sitting
  in **Completed** renders with live Advance buttons. `advanceToProfileCleanUp` then moves it into
  Clean-Up **without clearing Move to Onboarding**, so it lands carrying a stale `Advance to MN` and
  its only exit is permanently dead. That is exactly how Betty Dillingham and Eddie Quintero were
  pulled back out of Completed on 2026-08-27 (§9). The no-op check now REFUSES the second advance
  and tells the rep, so the patient can no longer be dragged backwards silently — but the button is
  still offered on a finished patient. Fixing it properly means wiring the completed-stage gate on
  that page, the same way the other four already do.
- **A Monday `location` column REJECTS a value with no `lat`/`lng`** — and an agent doing bulk
  work is the one writer that reaches Monday without the app's helpers. On 2026-09-02 a Claude
  Code session backfilling **Clinic Address `location_mm1xjnfv`** on the Welcome Call board sent
  `{"address": "…"}` alone for four minutes: **73 writes, 71 distinct clinic addresses, every one
  refused** with `ColumnValueException` — *"invalid value, please check our API documentation for
  the correct data structure for this column"* — at HTTP **200**, so nothing threw. That is the
  whole of the alert the gateway's failure watch raised that day. The run then switched to
  `{"lat":"0","lng":"0","address":"…"}`, which is exactly what every module's own `writeLocation`
  sends (*"Monday requires lat/lng; if we don't have coordinates yet we pass 0/0 — the address
  text still lands"*), and all 71 landed; **nothing was lost and no rep was affected.**
  ⚠️ Two lessons, both cheap: **bulk column writes belong in the module's `write*` helper**, which
  already knows every shape — hand-rolling a mutation is opting out of that knowledge; and a
  200-with-`errors[]` is the app's most common silent failure (§5.2, §9), so a bulk job must read
  `errors[]` and stop, or it will report a clean run having written nothing.
  ⚠️ **Diagnose this class from `/audit.json?key=…&failed=1&since=1`, never from `/audit/errors.json`.**
  The public summary groups by a REDACTED message, which is identical for every column type and
  every writer — it cannot tell you the board, the column or the actor, and the message alone
  invites you to blame the nearest recent change. `error_data` in the failed rows names
  `column_id`, `column_name`, `column_type` and the exact value sent.
- ✅ **CI's typecheck was a NO-OP until 2026-09-23 — now fixed, and the tree is at zero
  errors.** `deploy.yml` ran `npx tsc --noEmit` against the solution-style root tsconfig
  (`"files": []` + project references), which `--noEmit` does not follow: it loaded **zero**
  files under `src/` and exited 0 for every commit up to that date. Measured, not inferred —
  `npx tsc --noEmit --listFiles | grep -c /src/` returned `0`, and a file assigning a string
  to a `number` passed it. The gate is **`npx tsc -b --force`** now (~26s cold; `--force` so a
  cached `.tsbuildinfo` can never satisfy it), and the 14 errors that had accumulated behind
  the no-op are fixed. ⚠️ **Never put `--noEmit` back** — it silently checks nothing.
  ⚠️ **This gate is load-bearing, not hygiene.** At least two safety rules in this codebase
  are deliberately enforced BY the type system and by nothing else: `SupplyLengthField`'s
  required `options` prop (§5.31 — *"the guarantee moved into the type system where it cannot
  rot"*) and `sosEntryComplete`'s required `sosDespiteAuth` argument (§5.32c — *"Making tsc
  name every call site"*). Both were unenforced in CI for as long as the no-op stood. Verified
  2026-09-23 by dropping that argument at one call site: the old command exited **0** and all
  228 Insurance tests **passed**, while `tsc -b` caught it — the regression would have shipped
  a Humana card reading **"◷ Auth required"** with Send greyed out and no stated reason, the
  dead end §5.10 · §5.20 · §5.31c · §5.31f · §5.39d each record reversing.
  ⚠️ It catches **signature and shape drift only** — a changed argument list, a renamed field,
  a missing import. It would NOT have caught §5.31c's two-files-each-fine pair, §5.30f's
  `protected_static` URL, §5.46's full label column or §5.31g's unwritten columns. The scan
  tests remain the net for semantic drift.
- **`strictNullChecks` is OFF** (`tsconfig.app.json`: `strict: false`), and it costs more than
  it looks. Discriminated-union narrowing **requires** it, so `if (!r.ok) throw new
  Error(r.reason)` cannot narrow to the error arm — six OOP estimator tests carry an explicit
  `as OopEstimateError` cast for exactly that reason, marked to be dropped when it is turned
  on. Measured 2026-09-23: enabling it costs **~15 errors**, of which two are false positives
  (a defaults-first spread TS can't see as sparse; a `throw` guard it won't carry into a
  closure), one is dead code (`PatientsSidebar`'s tab block — no caller passes
  `showGroupTabs`), and the two worth a real look are `url: string | undefined` on file
  attachments in `EvaluatePanel:1783` / `SendRequestPanel:214`. ⚠️ Worth weighing against the
  fact that this codebase's most-repeated failure mode is a value reading blank with nothing
  erroring — which is the class `strictNullChecks` exists to catch.
- `README.md` points here; keep this file current as the architecture moves.

---
