## 9. Conventions & gotchas

- **Always push to `main` in this repo** (Josh's standing instruction, 2026-07). No feature
  branches or PRs unless he explicitly asks — commit, rebase onto `origin/main`, push `main`.
- **🚫 NEVER run the *Sync from Test Repo* workflow — only Josh presses it** (Josh, 2026-09-03,
  after a session ran it unasked). Pushing to test's `main` is your job; pushing test's `main`
  onto **prod** is his, every time. It is a force-push that overwrites prod and cannot be undone
  by re-running it. Finish on test, say it is ready for prod, and stop. Full rule in §8.
- **⚠️ Name the SCREEN, not the data.** Several screens surface the same board's columns — most
  often the **Welcome Call stage page** (`/welcome-call`, the rep's form) and the **Care Coordinator
  dashboard** (`/care-coordinator`, the coordinator's read-only queue, which reads Welcome Call
  columns). A note about one is not a note about the other, and a change to a piece they share
  (`masheke/mmKit`'s `PatientContact` above all) lands on both — that is how a button added for one
  screen was deleted off the other. The table is at the top of §5.30; when a note is ambiguous, ask
  which screen before building.
- **Verify before you advance.** Any new write that a Monday automation keys on must go through
  `executeWritesWithVerification` with the trigger column as `stageColumnId`.
- **⚠️ A stage advancer already holding its target value is a SILENT NO-OP — pass `expectedText`.**
  Monday automations fire on a status **CHANGE**, not on a value (7917676280 is literally *"When
  status **changes** to something, create item in board"*). Writing `Advance to MN` onto a column
  that already reads `Advance to MN` returns **200, writes nothing, and does not even record an
  activity-log entry** — so the automation never runs. `executeWritesWithVerification` could not see
  this: it deliberately EXCLUDES the advancer from read-back verification (the advancer is the thing
  being held back) and then fired it blind, returning `[]` — a clean send — while the patient never
  moved. Betty Dillingham (`12895834887`) and Eddie Quintero (`12895852715`), Aug 2026: both
  advanced correctly on 8/26, were dragged back out of **Completed** into Profile Clean-Up on 8/27,
  and from then on every press of Advance to MN was a no-op. Confirmed against the GATEWAY audit log
  (`/audit.json?item=…&all=1`), which is the only place these are visible: Katie wrote
  `color_mm1zmeb3 = Advance to MN` **six times** — 8/26 6:54 PM (the real one), then 8/28 4:37 PM and
  8/31 at 10:51, 11:42, 11:44 and 4:27 — and Monday answered **200 / ok=true to all six** while
  recording an activity-log entry for only the first. Five days, a green toast every time.
  ⚠️ **Monday's activity log CANNOT show you this and the gateway log can.** A no-op write leaves no
  activity-log entry at all, so on the board it looks like the rep never pressed the button; only
  `gql_log` proves they did. Diagnose this class from `/audit.json`, never from board history.
  **`lib/shared/advancerNoop.ts`** is the rule; an advancer task that carries **`expectedText`** is
  now checked against the pre-write snapshot in **Phase 2b** and the send is REFUSED with a message
  the rep sees, rather than firing a mutation that moves nobody. ⚠️ It is a **BEFORE**-the-write
  check on purpose: comparing the advancer *after* writing it cannot tell "unchanged because it was
  already that value" from "unchanged because Monday hasn't indexed it" — the very ambiguity that
  makes Phase 2 poll. ⚠️ **Opt-in by `expectedText`**: an advancer that declares no target keeps the
  old behaviour exactly, because guessing would flag real advances, and a false *"nothing moved"* is
  worse than the silence it replaces. Same check runs server-side in `send.mjs` (via the payload's
  `stageExpect`), and client-path hits POST to the gateway's `/telemetry/advancer-noop` — **grep
  Railway for `ADVANCER_NOOP`** to find every occurrence across both paths.
  ⚠️ **Do NOT "repair" a stuck patient by clearing the advancer.** Blanking it fires nothing, but the
  next press is then a real change → the automation fires → a **duplicate** downstream item. Both
  patients above already had theirs. The repair is to move the item to Completed, where the
  automation already put it.
  ⚠️ **How they got back into the queue** (unfixed, see §10): the last line of
  `advanceToProfileCleanUp` is `moveItemToGroup(p.id, GROUPS.profileCleanUp)` — an **UNCONDITIONAL**
  move that never asks which group the item is currently in, so it drags an item out of **Completed**
  as happily as out of a form group. Katie pressed "Advance →" on Info Collection at 11:57 AM (Eddie)
  and 12:23 PM (Betty) on 8/27; the audit log shows the left pane written, then
  `color_mm6ct431 = Profile Clean-Up` (itself a no-op — already set, ok=true, no activity-log entry),
  then the group move one second later. It also **does not touch Move to Onboarding**, and `UnverifiedReferralsPage` is the ONLY
  intake-family page that never wires `useCompletedStageReview` — `ProfilePage`, `EvaluatePage`,
  `WelcomeCallPage` and `ChaseBenefitsPage` all do. Combined with `useMondayPatients` injecting a
  deep-linked `?patientId=` into the sidebar **regardless of group**, a patient sitting in Completed
  renders on Info Collection with fully live Advance buttons.
- **⚠️ A send that WORKED must take the patient off screen — or reps re-press it.** The queue only
  learns about an advance on the next poll (masheke `POLL_MS` = 30s), and Monday may not have
  indexed the write even then, so for up to half a minute after a successful send the patient sat
  in the sidebar with the panel still rendering them and the Send button re-enabled — a screen
  indistinguishable from "nothing happened". Masheke re-pressed on three patients on 2026-09-03
  (Joseph Bowser `12936243860`, Robert Bianco `12936759879`, Frank Fuller `12937936786`): every
  FIRST press landed, every second was refused by the advancer no-op guard above. Nothing was lost
  — and nothing on screen had told her either way, because her second press ALSO showed green (see
  the poll-window note below). `useMondayPatients.markAdvanced` now drops the patient the moment
  the send resolves; `EvaluatePanel` calls it LAST in the try, and only when a stage was actually
  advanced (an escalating send leaves them in Evaluate MN, where they belong).
  ⚠️ **The marker is a CLAIM WITH AN EXPIRY, never a permanent verdict** —
  `lib/shared/pendingAdvance.ts` (+ tests). Hiding a patient whose write did NOT land removes them
  from the only queue that would surface them, which is the invisibility §5.10/§5.12/§7 keep
  recording. So it lapses after `PENDING_ADVANCE_TTL_MS` (2 min): if the advance landed the board
  stopped returning them long ago and the lapse changes nothing; if it did not, the patient is back
  in the rep's queue. Deliberately in memory — a reload is a fresh read, and a marker that outlived
  the tab could hide a patient nobody can bring back.
  ⚠️ **A marker is NEVER spent on ABSENCE** (Greptile, PR #54). The obvious optimisation — "not in
  the fetched queue any more, so the advance landed, drop it" — reads a missing row as evidence,
  and on these boards it is not: **every `fetchGroupItems` swallows a pagination error and returns
  the pages it got** (`catch { break }`), so a patient still in the stage can simply be missing from
  a poll. Spending the marker there un-hides them early, with a live Send button — the re-send
  window this exists to close. Same rule and same reasoning as the patient directory's
  `isOrphanRow` (§5.29): act on positive evidence, let absence mean nothing. The one cost is a
  nicety: a patient a manager returns to the queue inside the TTL stays hidden until it lapses.
  ⚠️ **Hide at the POINT OF COMMIT** (`setPatients(applyPendingAdvances(...))`), not where the list
  is built — same review. Everything in between is an await (the deep-link `fetchItemById`, above
  all) during which a send can resolve, and a list filtered earlier commits an array assembled
  before the marker existed, putting the patient and their Send button straight back on screen.
  ⚠️ **A TTL is needed because the SPA is never TOLD the send failed.** `EvaluatePanel`'s send
  passes no `requireDone`, so when `pollDone`'s **20s** window closes on a still-running job
  `submitSend` returns `"submitted"` and `verifiedWrite`'s `!requireDone` branch treats it as
  success — green toast, doctor writes, everything — and the job can still FAIL seconds later.
  That is exactly what the three sends above did. Expiry is therefore not a guess about why: it is
  a direct reading of the board, the only thing that settles whether the patient still needs
  working.
  ⚠️ **Now on every queue** — masheke (Evaluate · Send Request · Confirm Receipt), Insurance
  (Benefits · Submit Auth · Auth Outstanding), Welcome Call, Final Confirm and all four Profile
  Send Off exits. `applyPendingAdvances` takes the list the sidebar renders rather than a
  predicate, so each queue's hide uses that queue's OWN membership test and cannot drift from it
  (the §5.9/§5.10 keep-in-agreement trap). On the group-fetch boards the window it closes is even
  wider than masheke's: the patient sits there until the poll AND the Monday automation that moves
  the item.
  ⚠️ **Only a send that LEAVES the queue may hide.** Insurance is the trap: `authOutstandingOutcome`
  returns a null stage for "nothing resolved yet" and Benefits writes `benefitsSos` for a blocker —
  both leave the patient in place, and hiding them takes live work off the rep's screen.
  `sendPatientToMonday` therefore returns the stage it wrote and the three pages gate on
  **`lib/samantha/stageQueue.stageLeavesQueue`** (+ tests). masheke's panels gate the same way in
  their own vocabulary: Evaluate on `nextStage`, Confirm Receipt on its confirmed branch only,
  Send Request never on the "sent but the advance failed" path.
  ⚠️ **Deliberate carve-outs, not omissions:** Subscription writes no Stage Advancer at all; both
  Chase pages log attempts and re-date rather than advancing; DVS is a read-only monitor; the
  intake page's escalation exits already leave the rep's view by their own filter, and Send back to
  pipeline puts the patient back INTO a queue. A durably-queued-but-unconfirmed send
  (`GatewayPendingError`) never hides either — its own toast already says "don't repeat".
  `hooks/pendingAdvanceCoverage.test.ts` scans for the wiring, because a queue that loses it does
  not fail, it just goes back to re-sending.
- **Column IDs, not titles**, are the contract. Add new ones to `mondayMapping.ts` + the schema docs.
- **Exact label strings** for status/dropdown writes (Evaluate "Option A", coverage paths, etc.) —
  a casing mismatch creates duplicate board labels. Prefer index writes where possible.
- **Monday dates are ET, timezone-naive.** Don't compare with a bare `new Date()` in a non-ET runtime.
- **Notes are stamped `[ET timestamp] <Stage>: <text> —<initials>`** — one implementation,
  `lib/shared/noteStamp.ts` (`appendStampedNote`), used by every role's NotesPanel. The stage label
  is what makes a line traceable when several roles share one column: Benefits / Submit Auth /
  Auth Outstanding / DVS all append to Insurance `text_mm6vzc7q` (was `long_text_mm2ffsme` until 2026-09-03). A new NotesPanel must pass
  `notePrefix`, and note-writing paths outside the panels (Benefits call log, Propose Stuck /
  Approve Stuck / Return to Queue stamps, the machine-composed `[Auto-escalated …]` reason) take an
  `initials` arg — pass `userInitials()`. **Every** line that lands in a notes column is now
  attributed; the auto-escalation line is credited to the rep whose send raised it. Bracketed
  stamps keep the initials INSIDE the bracket so
  `extractProposedStuckReason` (Oversight's "Proposed Reason" column) still slices at the first `]`.
- **ISO text doesn't survive Monday's create-item automations.** The workflow engine type-sniffs
  TEXT tokens: `2022-01-01` is parsed as a date and re-rendered `01 January 2022` in the created
  item (confirmed 2026-07; `07/25/2016` passes verbatim). That's why "Stedi Plan Begin Date" text
  mangles at every board hop. The yyyy-mm-dd value rides in DATE columns instead — profile
  `date_mm4wh83f` (written by the SPA in `buildDataTasks`) → masheke `date_mm4w4jrv` → insurance
  `date_mm4wwm2b` → welcome call `date_mm4w5hbc` → subscription `date_mm4wqkk0` — copied
  date→date by the hop automations (date→date copies are verbatim). Never route a
  machine-parsed date through a text column across boards.
- **PHI everywhere.** Patient data is on every board. The gateway logs metadata only
  (`LOG_PAYLOAD=false`); keep it that way. Don't write patient data to logs/artifacts/commits.
- **Optimistic UI** in many panels marks state "saved" before Monday confirms; failures rely on a
  toast. Don't assume a green UI means a durable write (esp. Subscription — see §10).
- **⚠️ Inside `.pf-root`, a shadcn `<Button>` renders UNSTYLED — use the page's `.btn` classes.**
  `redesign.css` resets `.pf-root button { background:none; border:none; color:inherit;
  font:inherit }`. That selector is one class + one type, so it **out-specifies every single-class
  Tailwind utility** the Button carries: `bg-rose-600`, `text-white`, `text-sm` and `font-medium`
  all lose. Measured in a real browser (2026-08-19) the Propose Stuck button in the intake page's
  Escalation card computed to `background: rgba(0,0,0,0)`, near-black text, 16px/400 — plain text
  with a stray drop shadow, which is what "the Propose Stuck button on the right looks funky" was.
  `.pf-root .btn` is two classes, so it wins; `StageActionBar` takes **`skin="page"`** for exactly
  this, and any other shared component dropped inside `.pf-root` needs the same treatment. Don't
  reach for `!important` — the page has a complete button language already.
- **A failed READ is invisible unless a page says so — `components/shared/StaleDataNotice`.**
  Every queue hook catches a failed Monday read into `error` and clears it on the next successful
  poll (15s intake / 30s masheke), but most pages rendered that string only in the sidebar or in
  `EmptyPatientPane` — i.e. only when the list is EMPTY. So the common case was silent: a rep works a
  patient, a background poll fails, the screen keeps showing what it had. On 2026-09-01 Monday 500'd
  eight reads at 12:07 ET and 503'd two more at 13:55 and nobody in the app saw anything.
  The notice now sits under the header on all 14 queue pages, self-clears, and has no dismiss button
  (dismissing a notice while the data is still stale is worse than not having one).
  ⚠️ **Scope is required and per-FETCH.** On the intake page the queue list and the open patient's
  detail are separate requests (§5.25) that fail independently, so they get separate notices.
  ⚠️ **Field-level pinpointing is opportunistic, not promised.** `mondayError.fieldsFromGraphQLErrors`
  reads `errors[].path` when Monday sends one; every real failure that day was either a bare HTTP 503
  (no GraphQL body exists) or `Internal Server Error` with NO path. Never name fields the payload did
  not — the honest unit is the scope.
  ⚠️ **Both notices sit OUTSIDE `.pf-root`** on Profile / Patient Intake — it deliberately does not
  wrap the sidebar or header — so they take the DEFAULT Tailwind skin. Inside `.pf-root` that is
  inverted (see the `.pf-root` button note above); out here `.btn` has no styles to inherit.
- **Alerting pages on failed WRITES, not on failed calls** (`sendAlerts.sweepAlertReason`,
  2026-09-01). A failed write is a save that did not land; a failed read self-heals on the next poll
  and nobody can act on a Monday 503 anyway. Pooling them paged Josh twice in two hours for two
  transient blips (10 failures / 23,719 requests, zero writes lost). Reads now need BOTH a count
  (≥25) and a rate (≥2%) — a rate alone pages on 1-of-2 at 3am, a count alone pages on a busy
  afternoon that is fine. ⚠️ The old wording, *"8 failed Monday calls (of 76 writes)"*, read as
  "8 of the 76 writes failed" and cost real incident time; the headline now leads with what was lost.
- **A notes box is keyed by its patient, and no send leaves the page while it holds un-added text**
  (Brandon, 2026-09-03; fixed 2026-09-04). He typed a note on Final Profile Confirmation, pressed
  *Confirm Profile & Send* without pressing Add, opened the next patient — and the text was still
  sitting in that patient's box: never written, one click from the wrong chart. Cause: the stage
  pages mounted `<NotesPanel notes={selected.notes} …>` with **no `key`**, so React reused the same
  box (draft included) across a patient switch. Eleven mounts had it. Every mount now carries
  `key={selected.id}` / `key={patient.id}`, every box reports its draft to **`lib/shared/pendingNote`**
  (`components/shared/pendingNoteGuard` `usePendingNoteReport`), and every action that leaves the
  patient — the six stage sends, the three Profile Send Off exits, the intake exits, the Chase attempt
  save — opens with **`refusePendingNote()`**: *"Press Add on your note before sending"*, the gate
  EvaluatePanel already had for its own box. Nothing is discarded for the rep; Add or clear, then
  send. `notesDraftIsolation.test.ts` scans for all three. ⚠️ Keying is required on top of the guard:
  a remounted box starts empty, and the masheke panels reset their lifted `pendingNoteText` on
  `patient.id` for the same reason — a lifted flag that outlives the box blocks the NEXT patient's send.
- **A DEEP-LINKED patient goes through the overlay, in the same commit as the queue** (MM-1094,
  2026-09-23). Every role hook re-fetches a `?patientId=` that is not in its own queue on EVERY poll
  and adds it to the list. The Profile hook `unshift`ed that record RAW (since 2026-05-11), so on
  `/profile` the rep's unsaved edits were replaced by Monday's copy every 15s — every 4s while a
  Stedi check polls — and fields blank on the board came back red. Janelle: *"All fields keep
  resetting and showing as red after I made an update"* (address, gender, insurance, serving).
  ⚠️ **Only an OUT-OF-QUEUE patient can hit this** — a queue row always went through the overlay —
  which is why it survived four months. Hers was a *New Form — Partial Leads* patient on `/profile`;
  the ticket URL is the one the Comms Hub's **Profile** step chip built, which took `board.route`
  for every Profile Send Off group (most likely how she got there — no other door found in the code
  builds that URL for a form-group patient). Three fixes: the Profile hook merges the overlay (the
  as-received snapshot stays PRE-edit); **Final Confirm** had the same raw injection in a SECOND
  `setPatients` after the list committed, so the patient also blinked out for the length of each
  fetch — now added before the commit, the masheke shape; and the chip is **`dossier.stepOpenHref`**
  — a live record opens its GROUP's page (`item.route`, the answer the pane's "Open on" button and
  Search already gave), a completed one still opens in review mode on the board's page.
  `hooks/deepLinkOverlay.test.ts` scans all six hooks for the raw shapes; both halves verified to
  fail on the old code. ⚠️ **`/profile`'s Save Progress is BROWSER-ONLY** (`prof-overlays` in
  localStorage) — nothing typed there reached Monday, so no board data was overwritten. If she
  pressed Save Progress, her edits are still in that browser's `prof-overlays`, and **Info
  Collection reads the same key** (`fetchDetail` applies it) and saves to Monday — so opening the
  patient on `/unverified-referrals` recovers them even before this deploys. Otherwise they went
  with the tab.
- **Reset DISCARDS the rep's edits; it never WRITES an edit of its own — every stage page calls the
  hook's `discardEdits`** (2026-09-23, found auditing for MM-1094's class). ⚠️⚠️ **Five Reset
  buttons were a data-loss path.** Welcome Call, Final Confirm, Benefits, Submit Auth and Auth
  Outstanding called `clearOverlay` and then `update(id, { …blanks })` to empty the form on screen —
  and `update` writes the OVERLAY, which every refetch merges back over the board. So the blanks
  outlived the toast's "refetching from Monday", and the next Send wrote them: the Insurance send
  writes Call Reference Notes whenever `p.notes` is a string, so `notes: ""` replaced the column
  every Insurance stage shares (and Add note then appended one line onto `""` and wrote THAT over
  it); the Final Confirm send writes all five Last Bill dates unconditionally, so Reset → Send erased
  every one — §5.32e's *"NEVER EVER should something be deleted"* through a button labelled Reset.
  The other six (the five masheke stages, Subscription) called `clearOverlay` alone, which drops the
  entry but changes nothing RENDERED — `patients` holds the MERGED record — so the discarded edits
  stayed up until a refetch landed, masheke's `resetVersion` bump re-seeded the panel FROM them, and a
  failed refetch made them permanent.
  `discardEdits` is the one call that does the whole job: drop the overlay, forget it in storage, and
  put the board's own copy back on screen synchronously from **`baseRef`** — the pre-overlay copy
  every hook now keeps (Welcome Call's device from PR #57). ⚠️ **It is deliberately NOT
  `clearOverlay`**, which runs after a SEND: restoring the pre-send board record there would flash
  the old values on a patient who stays in the queue and read as a save that didn't take. Welcome
  Call is the one exception, and aliases the two, because its send always advances the patient off
  screen. ⚠️ masheke's copy is taken AFTER the NAD backfill and escalation self-heal, which mutate the
  rows, and reverts all three lists (`patients`, `chaseViewerPatients`, `scheduledApptPatients`) —
  Evaluate edits chase-stage patients opened from its sidebar folder. A patient with no base entry is
  left alone: blanking would invent data. `pages/resetDiscardsEdits.test.ts` scans every
  `resetForNewPatient` (eleven, pinned by name) for `discardEdits(` and against `update(` /
  `clearOverlay(`; `hooks/discardEdits.test.tsx` holds all five hooks to restoring the board value
  while the refetch hangs, when it fails, and across a reload after Save Progress. Both were verified
  to fail on the old code. **A Reset that needs a field "emptied" is asking for the board's value —
  which is what `discardEdits` already shows.**
- **Toasts are TOP-CENTRE (`App.tsx`), and both other corners are ruled out by past bugs.**
  Bottom-right is where every stage page puts its primary action, so a toast landed on the button
  the rep presses next — adding a note on Evaluate popped "Note saved to Monday" over **Completed
  Evaluation** and swallowed the click (Brandon, 2026-08-19). Top-right covered the file preview's
  Close button, which is why it had been moved to the bottom in the first place. Page headers are
  `justify-between` — title left, actions right — so the top centre is the one strip of the
  viewport with nothing clickable under it.
- **Stale-tab chunk 404s self-heal** (`lib/shared/chunkReload.ts` + `components/shared/AppErrorBoundary.tsx`,
  added after the 2026-07-14 white-screen incident): every Pages deploy replaces ALL hashed JS chunks, so a
  tab left open across a code deploy 404s its next lazy page load — and React unmounts the whole app on an
  uncaught render error. `lazyWithReload` + the `vite:preloadError` guard reload the tab ONCE (sessionStorage
  `mm-chunk-reload` breaks loops; a second consecutive failure renders the root error boundary's Reload
  screen instead of a blank page). **New lazy routes in `App.tsx` must use `lazyWithReload`, not bare
  `lazy`** — and note the Vite trap: `preventDefault()` on `vite:preloadError` makes Vite resolve the failed
  import with `undefined`, which must never be treated as a successful load (see chunkReload's comments/tests).
- **Back-navigation is history-first** (`hooks/useBackNavigation.ts`): `goBack()` does `navigate(-1)`
  when there's in-app history, else falls back via `?from=system-mgmt` (→ `/system-mgmt`) or
  `?manager=1`. Manager views deep-link into role pages with `?from=system-mgmt`, so Back returns the
  user to where they were (the oversight drill-down "feels seamless"). Don't swap it for a hardcoded
  home route.

---
