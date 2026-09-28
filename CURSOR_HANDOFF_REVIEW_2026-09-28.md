# Response to Cursor's launch-bugs handoff — 2026-09-28

**Responds to:** `JOSH_HANDOFF_LAUNCH_BUGS_2026-09-28.md` — Cursor's first version `b61bbec` on branch
`cursor/launch-bugs-handoff-bad3`, and its revision `e747b0f` on `main` (item #5 dropped, #5b added).
This branch now carries the revised version.
**Code reviewed:** `main` at `3bb7c22`, the same night. The handoff adds only a document; the code it
describes is `main`'s. Line numbers below are from that commit; the symbol names will outlive them.
**Written by:** Claude Code, overnight, for Josh's morning triage (§1–§4) and for future Cursor sessions
(§5). The short form of §5 is `.cursor/rules/command-center-read-first.mdc`, which Cursor loads on every run.

---

## 1. Bottom line

Cursor's list is good and worth the morning. Every item points at real code, and 13 of the 14 describe
the behaviour accurately as written. Where it needs adjusting:

- **#5 was stale in the first version and Cursor caught it itself** an hour later (`e747b0f`): the
  "browser pickup reads We called" premise was disproved on 2026-09-27 and fixed at the source in
  `6a58088`. Its replacement, **#5b** (the fallback Calls list shows in-progress RingCentral rows), is
  confirmed and small.
- **#13 is broader than written.** Only Evaluate's and the Profile writers' advancer tasks carry
  `expectedText`. Seven other advancer writes fire without it, not three.
- **#8 is stronger than written.** The `comms` ability's own hint text promises to hide the Call / Text
  buttons on a patient, and nothing on the patient screen reads the ability.
- **#4's consequence is not verified.** This tab can no longer answer the inbound and its ringtone goes
  silent — that much is certain. Whether the caller lands in voicemail or another device on the shared
  extension picks up depends on RingCentral's ring configuration, which neither of us checked.

Three items were already on record before the handoff and should have said so: **#10** is
`WRITE_RELIABILITY_AUDIT.md` M6, **#12** is in `docs/claude/10-known-risks.md` (Josh chose on 2026-09-01
to leave it), and #5's residual sat under "Recorded, not fixed" in §5.49 and §5.53.

Nothing on the list loses data. **#1 is the one that will produce "where did my patient go?" on launch
morning**, and it is the one I would fix first; the fix is small and testable.

---

## 2. Item-by-item verdicts

| # | Cursor's item | Verdict | Severity (mine) | Already known? |
|---|---|---|---|---|
| 1 | Pending-advance hide follows the item into the next same-board stage | **Confirmed** | Critical | No |
| 2 | Cash Pay corrected back to a payer still skips to Welcome Call | **Confirmed** | High | No |
| 3 | Open ‹tool› on a Completed record is still writable on six pages | **Confirmed** | High | The intake-page instance is (§10) |
| 4 | Dial while an inbound is ringing strands the inbound | **Confirmed**; "voicemail" unverified | High | No |
| 5 | Browser pickups still read "We called" on counts | Stale; Cursor withdrew it in `e747b0f` | — | Yes: fixed `6a58088` |
| 5b | Fallback Calls list shows in-progress RingCentral rows | **Confirmed** | Low | Same family as §5.53 3b |
| 6 | Numberless Log attempt shows Hang up for an unrelated call | **Confirmed** | Medium | No |
| 7 | Header search: retype + Enter opens the previous patient | **Confirmed** | Medium | No |
| 8 | `comms: false` still shows Call / Text on the patient screen | **Confirmed**, and the hint text promises otherwise | Medium | No |
| 9 | Click Call during a call records a phantom dial | **Confirmed** at 4 of 5 dial sites | Low–Medium | No |
| 10 | Final Confirm split writes race the automation | **Confirmed**, unchanged | Medium | Yes: M6, §10 |
| 11 | Patient-screen stage embed serves a stale cached record | **Confirmed** | Low–Medium | No |
| 12 | Completed intake deep-link still offers Advance | **Confirmed** | Medium | Yes: §10, left on purpose |
| 13 | Advancers lacking `expectedText` | **Confirmed**, broader | Medium | No |
| 14 | Clean-Up advance: move fails, "press again" is refused | **Confirmed** | Medium | No |

### Notes per item (where there is something to add or correct)

**#1 — confirmed end to end.** `sharedPendingAdvances` (`src/lib/shared/pendingAdvance.ts:84`) is one
`Map<itemId, markedAt>` for the whole app. Every queue hook filters its list through it at commit
(`hooks/masheke/useMondayPatients.ts:288`, `samantha/…:193`, `welcomeCall/…:177`, `finalConfirm/…:142`,
`profile/…:305`) and refuses to inject a claimed deep-link id (`masheke/…:270` and the same guard in each).
Medical Evaluation, Insurance, Welcome Call and Profile Send Off each carry several stages on one item id,
so a claim written by Evaluate is honoured by Send Request. The Care Coordinator case is real too, and
sharper than the handoff says: `INTAKE_GROUP_IDS` (`src/lib/careCoordinator/mondayApi.ts:169`)
*deliberately* includes the Profile Clean-Up group, so an Info Collection → Clean-Up advance hides a card
that should have moved buckets, not vanished.
*Fix direction I would take:* keep the map global (the 2026-09-25 measurement in the module header still
holds) but record the stage or group the patient was advanced **from**, and let `applyPendingAdvances`
take a `stageOf(row)` accessor: hide a row only while the board still shows it where it was advanced
from. A row Monday already returns in the next stage is positive evidence the move landed, which is the
only kind of evidence the module's header says it will act on; absence still means nothing. Each hook
already knows its rows' stage or group, and the Care Coordinator column knows each row's group.

**#2 — confirmed.** `isCashPayPatient` is an OR (`src/lib/shared/cashPay.ts:78`);
`primaryInsuranceForGeneral` mirrors only *into* Cash Pay (`src/lib/profile/cashPayIntake.ts:51`). Its own
comment says a patient "corrected AWAY from Cash Pay keeps whatever the rep then chooses", but section 1
is hidden while Primary reads Cash Pay (`UnverifiedReferralsPage.tsx:1268`), so the rep cannot choose
anything. `/profile` shares the module and the behaviour. *Decision for Josh:* clear Primary when General
leaves Cash Pay (section 1 and Stedi come back, Advance says MN), or make **intake** key on General
alone. Downstream boards only carry Primary, so the OR stays right there.

**#3 — confirmed.** `subStageOpenHref` (`src/lib/patient/patientScreen.ts:350`) adds `completedStage=` to
every tool's link; only `EvaluatePage`, `ChaseBenefitsPage`, `WelcomeCallPage` and `ProfilePage` read it.
The masheke hook injects any deep-linked item regardless of group, and `SendRequestPanel`'s Mark Complete
has no stage or review check of its own (`SendRequestPanel.tsx:472–497`). The comment at
`OnboardingView.tsx:384` claims the link "disables the send there"; it does on four pages. The Open link
is only offered to people assigned the tool's role, or managers (`mayWorkRoute`), which narrows who can
trip this, not whether it fires.

**#4 — confirmed.** `doDial` (`src/lib/softphone/softphone.ts:847`) checks `this.active` only;
`syncRingtone` (`:1009`) stops the ringtone the moment `active` is set; `doAnswer` (`:813`) then refuses.
See §1 for the unverified part.

**#5 / #5b.** Agree with Cursor's own re-verify. `contact-totals` reads `call_archive`, not RingCentral,
and `6a58088` both stops archiving unfinished records and repairs old rows' `direction` on the deep pass.
What remains: the popup's fallback `CallHistoryList` reads RingCentral live through `toPatientCall`
(`src/lib/callHistory/callHistory.ts:160`) with no `finished` check, and `fetchPatientCallHistory` asks
for `type=Voice&view=Detailed` with no such filter either, so an in-progress call can show one row
wrongly until it ends. Note `toPatientCall` defaults a *missing* direction to Inbound, the opposite of
the archive's old default; harmless once unfinished rows are dropped.

**#6 — confirmed** at `CallPatientDialog.tsx:109`. The mount effect a few lines above already guards
`digits &&`; the `live` line does not. `DialPatientDialog.tsx:74` has the same shape (its effect guards
`!digits`, its `live` does not).

**#7 — confirmed.** `useLiveSearch` bumps the generation and aborts on a query change
(`useLiveSearch.ts:152`) but leaves `results` alone; `GlobalSearch` never reads `searchedQuery`
(`GlobalSearch.tsx:62`) and Enter navigates `rows[hi]` unconditionally (`:121`). The footer's "Enter opens
the first" is only rendered when `!searching`; the handler does not honour that.

**#8 — confirmed, and stronger than written.** `ABILITY_HINT.comms` (`src/lib/shell/abilities.ts:310`)
says: *"Shows the Communications tab, and the Call / Text buttons on a patient … they just cannot start a
message."* `PatientCommsColumn.tsx` contains no ability check and `PatientBody.tsx:99` checks
`editProfile` only. Either the column gates on `useAbility("comms")` with an `AbilityLockNote` (the
§5.39h rule: a control that vanishes silently is worse than one that says why) or the hint text changes.
Josh's call.

**#9 — confirmed** at `PatientCommsColumn.tsx:104`, `DialPatientDialog.tsx:66`, `CallPatientDialog.tsx:94`
(it guards only the same-number case) and `AssignedPatientsPage.tsx:304`; only `CommunicationsView.tsx:200`
returns early on an existing `call`. The consequence Cursor names (suppressing pickup repair) matters less
now that RingCentral is known to log pickups Inbound; the mislabelled "We called · ‹rep›" on a neighbouring
call is the real effect. The clean fix is one place rather than five: report the dial from inside the
softphone's dial path, after its own `active` check.

**#10 — unchanged** since the audit wrote it up as M6 (`FinalConfirmPage.tsx:278–284`). Not new.

**#11 — confirmed** (`useStageRecord.ts:65–69`). The embed is `inert`, so the wrong chart is an audit-view
problem only. `useSubscriptionRecord` already has the paint-then-re-read pattern to copy.

**#12 — known and deliberately left** (`docs/claude/10-known-risks.md:151`). The same gate as #3 fixes it.

**#13 — confirmed and broader.** Advancer tasks **without** `expectedText`: Welcome Call
(`src/lib/welcomeCall/mondayWrite.ts:417`), Insurance (`src/lib/samantha/mondayWrite.ts:719`), Final Confirm
(`src/lib/finalConfirm/mondayWrite.ts:460`), Send Request Mark Complete (`SendRequestPanel.tsx:473`),
Confirm Receipt (`ConfirmReceiptPanel.tsx:889`), Doctor Appointment (`src/lib/masheke/mondayWrite.ts:629`),
back-to-Chase (`:788`) and Update Clinicals (`:839`). **With** it: Evaluate (`EvaluatePanel.tsx:562`), both
Profile advance writers and the Clean-Up advance. Adding it needs the exact label text Monday reads back
for each index on each board, or the guard will refuse real advances — not a launch-morning change.

**#14 — confirmed** (`src/lib/profile/unverifiedWrite.ts:910–990`): the sub-stage task carries
`expectedText: "Profile Clean-Up"` (`:932`), then `moveItemToGroup` (`:974`); on a move failure the error
says "press Advance again", and the second press is refused by the no-op guard because the column already
reads Profile Clean-Up. *Fix:* on that path retry the move itself, or let a second press skip the sub-stage
task when the column already reads Clean-Up and only move.

---

## 3. Independent review (things not on Cursor's list)

_In progress: four independent sweeps (recent commits · stage-advance and write paths · comms and softphone · cash pay, intake, dashboard and counts) are running overnight. Their verified findings replace this line in a follow-up commit on this branch._

<!-- SECTION3 -->

---

## 4. Suggested morning order

1. **#1** — decide the fix (stage-scoped claim, above) and ship it with a test per hook. Verify: Evaluate →
   `/send-request` immediately; Benefits → `/submit-auth`; Welcome Call → `/final-confirm`; Info Collection →
   Clean-Up, then the Care Coordinator column.
2. **#3 + #12** — one gate, six pages: `reviewMode = !!useCompletedStageReview(selected?.id)` and pass it to
   each panel's advance action. Verify: Open Send Request on a Completed ME item; the stage actions are dead.
3. **#2** — Josh decides clear-Primary vs General-only; either is a few lines in `cashPayIntake.ts` plus the
   page test. Verify both directions: Cash Pay → Aetna shows section 1 and says MN; plain Cash Pay still →
   Welcome Call.
4. **#4** — refuse `doDial` while a non-ignored ring exists, with a message naming the ringing number.
5. **#14** and **#7** — small and self-contained.
6. **#6, #8, #9, #11, #5b** — small; as time allows.
7. **#13** — after launch, with each board's label text read back from `settings_str`.
8. **#10** — leave as documented (M6).

---

## 5. For future Cursor sessions: how this repo works, and how to hand off so it helps

You are reading a React + TypeScript SPA whose database is Monday.com. Nothing here is a criticism of the
handoff above; it was useful, and its shape should be kept. This is what would have made it land faster.

**Read in this order before reviewing anything.**
1. `CLAUDE.md` at the root. It is short on purpose and every session reads it. §1 is the mental model, §5
   the five mechanisms everything depends on, §9 the rules that apply everywhere.
2. `docs/claude/11-where-to-look-first.md` — about 240 symptoms mapped to the section that explains them.
   Grep it with the symptom.
3. The `docs/claude/<number>-*.md` file for the area you are in. A code comment that says "§5.31d" means
   that file. They record the decisions, the measurements taken on the live boards, and the ⚠️ notes about
   what not to do; most of those exist because a bug shipped once.

**Before you report a bug, check three places:** `docs/claude/10-known-risks.md`,
`WRITE_RELIABILITY_AUDIT.md`, and `git log --since="7 days ago"`. Three of the fourteen items above were
already there, and one had been root-caused and fixed the day before. "Known — M6, unchanged" is more
useful to us than rediscovering M6.

**Mechanisms you have to understand to review this app** (the file to read in brackets):
- *Monday automations move patients, not the app.* The app writes a "stage advancer" status column
  **last**, after every data column has been written and read back (`lib/shared/verifiedWrite.ts`, §5.2).
  Anything that writes an advancer outside that path, or before the data, is a bug by definition.
- *Automations fire on a status CHANGE, not on its value.* Writing the value a column already holds returns
  200 and does nothing. `expectedText` on an advancer task lets `lib/shared/advancerNoop.ts` refuse such a
  write. That is why #13 matters and why "press it again" can never be a fix.
- *A hide is a claim with an expiry* (`lib/shared/pendingAdvance.ts`). Read its header before proposing a
  change: the 15 minutes is measured, "never spend a marker on absence" is deliberate, and the fix for #1
  has to respect both.
- *HTTP 200 is not success.* Wrong-shaped values, label ids the column doesn't have, and long-text past
  2,000 characters all come back 200 and write nothing. Status label ids are per column and Monday picks
  them; never infer one.
- *Column IDs are the contract*, titles are not. Every `lib/<role>/mondayMapping.ts` maps domain fields to
  ids. A blank cell means unknown, not "no".
- *Counting contract* (§5.8): `hooks/useRoleCounts.ts`, each role's sidebar, `scripts/snapshot-baseline.mjs`
  and `services/baseline-cron/index.mjs` must agree by hand. The "change it in all N places" lists in the
  docs are real; the failure is a patient counted in the wrong bar or in none.
- *Monday dates are Eastern with no time zone.* Compare date parts in ET, never through `new Date()` in a
  UTC runtime.
- *One RingCentral extension for the whole company* (§5.13b, `INCIDENT_2026-08-20_RINGCENTRAL.md`).
  Per-patient RingCentral reads happen when a patient is opened, never on render or a timer. The call log
  cannot say who dialed; that is what `reportDial` is for.
- *Name the screen, not the data* (§5.30). `/welcome-call` and `/care-coordinator` share components; a
  change to one lands on both.
- *Deep links inject from any group.* Every `hooks/*/useMondayPatients.ts` injects a `?patientId=` item
  whatever group it is in; `?completedStage=` read through `useCompletedStageReview` is the write gate for
  finished records. #3 and #12 are pages without it.
- *Test and prod.* This repo is the source of truth; prod is a mirror reached only by the "Sync from Test
  Repo" workflow. **Never run it.** Only Josh does.

**How to hand off so we can act on it in the morning:**
- Keep the Situation → What's wrong → Where → Why → Verify shape. It was the best thing about this handoff.
- Say which commit you reviewed, and prefer symbol names to line numbers (`useStageRecord`'s cache hit in
  `run()`, not "line 66"); lines drift daily.
- Mark each item Confirmed (you traced the path end to end) or Suspected (plausible, plus exactly what you
  could not check). "Why we think this" was a good start.
- Rank by what happens to a patient or a rep, not by how wrong the code looks: moved to the wrong board >
  a rep re-pressing > a wrong label on a historical row.
- Cross-reference: "known (§10)", "M6, unchanged", "fixed in ‹sha›; residual is …".
- Don't include fixes you couldn't run the gates on. The typecheck gate is `npx tsc -b --force` (never
  `tsc --noEmit`, which checks nothing here); tests are `npm test`. Many rules are pinned by named tests;
  if one fails after your change, read the section it cites before touching the test.
- Patient data is on every board. Item ids and a few names already appear in the docs as incident anchors;
  don't add phone numbers, DOBs or addresses to anything committed.
- Durable knowledge goes in `docs/claude/` as a new numbered file plus one index line in `CLAUDE.md` §5,
  never into `CLAUDE.md` itself and never as an `@`-import. A dated `*_HANDOFF_*.md` at the root, like
  yours, is fine for a one-off.
- Claude Code pushes to `main` on Josh's standing instruction, rebased onto `origin/main` first because
  baseline-cron and access-config commits land on their own. If he tells you the same, do the same.
