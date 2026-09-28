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

My own pass (§3) adds three things I would put on the same morning: **A**, the Communications Hub and the
Fax panel open every live Medical Evaluation patient on `/evaluate`, whose Send rewrites the sub-stage and
can drag a Chase patient back to Send Request; **B**, Send Request's typed-but-not-added note is destroyed
by Request Sent because its gate is dead code; **C**, a paid cash-pay order reads "Placed — waiting for
Cardinal" and is counted as no work. The rest of §3 is medium and low, and §3 ends with what was checked
and found sound so nobody re-reviews it.

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

Four sweeps ran overnight as subagents — recent commits since 2026-09-23 · stage-advance and write paths ·
comms, softphone and on-screen state · cash pay, intake, dashboard and counts. **I re-read the cited code
for every item marked Confirmed below.** Suspected means the mechanism is in the code but one link could
not be checked from source; it says which. Nothing here is recorded in `10-known-risks.md` or the audit.

### High

**A. The Communications Hub and the Fax panel open every live Medical Evaluation patient on `/evaluate`,
whose Send rewrites the sub-stage** · Confirmed.
*Situation:* a rep opens a Chase Clinicals, Confirm Receipt or Doctor Appointment patient from the Hub's
tracker step chip, its "Open on Medical Evaluation" button, or a Fax-panel match, sees the Evaluate form
and presses Send. *What's wrong:* Medical Evaluation keeps every live sub-stage in one group, and the Hub
routes by group (`src/lib/systemMgmt/mondayApi.ts:457` maps the whole "Medical Necessity" group to
`/evaluate`; `src/lib/commsHub/dossierApi.ts:141` `routeFor`; `src/lib/commsHub/dossier.ts:299`
`stepOpenHref` uses `item.route`; `PatientDossierPanel.tsx:551`; `FaxPanel.tsx:376`). The Evaluate hook
injects any `?patientId=`, and `EvaluatePanel` writes `COL.subStage` with no look at the item's current
sub-stage (`EvaluatePanel.tsx:562–566`): "Send Request" drags a Chase patient back and the send's roll-up
clears the attempt columns, or "Completed" skips Chase. Search (`MASHEKE_STAGE_ROUTES`) and the patient
screen (`subStageOpenHref`) route the same patient correctly, so it depends which door the rep uses.
*Fix:* route Medical Evaluation items in `dossierApi.routeFor` by `stageAdvancerText` through
`MASHEKE_STAGE_ROUTES`, and make each masheke panel refuse its send when `patient.subStage` is not its own
stage. The second half also closes the stale-link case in item F.

**B. A typed-but-not-added note in Send Request is destroyed by "Request Sent" and "Mark Complete"** ·
Confirmed.
`SendRequestPanel.tsx:533–534` computes `noteBlocked` and nothing reads it; the file never calls
`refusePendingNote`. The send advances, `onAdvanced` → `markAdvanced` removes the patient at once, the
keyed Notes box unmounts, the draft is gone. `notesDraftIsolation.test.ts` counts this panel as
self-gated because it only regexes for the `pendingNoteText.trim().length > 0` string. *Fix:*
`if (refusePendingNote()) return;` at the top of `handleMarkComplete` and the send path; make the scan
test require a call site.

**C. A paid cash-pay order reads "Placed — waiting for Cardinal" and leaves the To-place bucket and
count** · Confirmed · Medium today, High the day ordering from the Command Center is switched on.
`orderStage` (`src/lib/orders/workflow.ts:307`) files `Paid Cash` with `Process Claim`: with no Cardinal
record it becomes `inProgress`, so the sidebar shows it under In progress, the headline says "Placed —
waiting for Cardinal" (`headline.ts:68`), and the Orders count and both baselines count only status
`Order` (`useRoleCounts.ts:835`, `snapshot-baseline.mjs:502`, `baseline-cron/index.mjs:518`). Yet §5.48
says `Paid Cash` is what the Stripe webhook writes on payment, "the one state that most needs placing",
placeable since 2026-09-21 (`placeabilityReason` returns `""` for it), with the CAH Order Number as the
"already placed" evidence. `ORDERING_FROM_COMMAND_CENTER` is `false` (`orders/config.ts:21`), so the
Place button is dark for everyone today; what a rep sees now is an unplaced order described as placed.
*Fix:* `Paid Cash` with a blank CAH Order Number is `toPlace`, in `orderStage`, the hook and both
generators together (§5.8), pinned by a stage test.

### Medium

**D. "Use this tab" while a call is ringing declines the ring** · Confirmed at code level.
`takeOver` refuses only when a call is live (`softphone.ts:347–349`); the old leader's `demote()` →
`release()` → `wp.dispose()` (`:744–751`), and the file's own header (`:216–221`) says `dispose()`
"declines ringing sessions, which this file never does". The badge offers the button on `!phone.call`
alone (`CallConnectionBadge.tsx:129`). The `.decline(` scan in `softphoneRules.test.ts` cannot see this
path. The RingCentral-side effect of one device declining is the header's own stated rule (§5.13b), not
re-measured tonight. *Fix:* refuse `takeOver`/`canTake` while `snapshot.rings.length > 0`.

**E. A resolve pressed on the patient screen can mark another item's texts read** · Confirmed at code
level; needs the alternate number to file under a different Inbox key (the shared caregiver-line case
§5.49 already handles with `noteTarget`).
`PatientCommsColumn.tsx:135` hands `[phone, alt]` to the resolve bar; `ResolveBar.tsx:135` calls
`markTextsRead(textNumbers, coversThrough)` with that pair; the gateway's `/comms/state` resolves ONE lead
key and only that item's numbers (`commsInbox.mjs:1417–1419`). The other item's unread inbound texts are
marked read in RingCentral while it stays open. The Inbox path is right (`ItemTimeline.tsx:263` passes
the item's own `reachable` numbers). *Fix:* have `/comms/state` return the item's numbers and pass those.

**F. Insurance, Final Confirm and Welcome Call sends write the stage their PAGE means, never the item's
current stage** · Mechanism confirmed; how often a stale link is followed is unknown.
`sendPatientToMonday` picks the Insurance Stage Advancer purely from `context`
(`samantha/mondayWrite.ts:570–578`, `:692`); Final Confirm writes Completed and Welcome Call writes Review
Profile unconditionally (`finalConfirm/mondayWrite.ts:460`, `welcomeCall/mondayWrite.ts:417`). The hooks
inject any deep-linked item, so a bookmark or an Oversight link that outlived a move lands an Auth
Outstanding patient on `/benefits` and a Send writes Complete (firing the Welcome Call hop with the auth
unresolved). Search and the Hub route these boards by group correctly, which is why this needs a stale
link. *Fix:* one guard per writer: compare `p.groupId` / `p.stageAdvancerText` with the context's stage
and refuse with "this patient is in ‹stage›; open them there".

**G. In-progress RingCentral rows render as finished calls on the Hub's Phone tab and as sidebar contact
marks** · Confirmed in code; that list reads return in-progress rows is §5.53 3b's measurement, not
re-observed tonight. Beyond Cursor's #5b: `callConnected` (`callHistory.ts:99`) treats an unknown result
with duration 0 as not connected, so an inbound call still ringing renders "Missed their call" and a rose
`missedTheirCall` mark (`contactState.ts:285`) on the masheke, orders and Patient Questions sidebars
(refreshed every 5 min); an outbound in progress reads as a completed "We called · m:ss". *Fix:* port
`isUnfinished` to `callHistory.ts` and filter in `toPatientCalls`, `PhonePanel.toRows` and
`contactState`. Same one-line filter as #5b, applied in three places.

**H. Propose Stuck / Approve / Send back never check for an un-added note** · Confirmed.
`StageActionBar.tsx`, `ProposeStuckButton.tsx` and `ProposeStuckModal.tsx` contain no `refusePendingNote`
call (whole-repo grep: only the pages, `ChaseClinicalsPanel` and `SubscriptionView` call it). The
proposal's own reason is saved; the patient leaves the list (Welcome Call and Final Confirm at once via
`handleLadderDone` → `markAdvanced`), the keyed box unmounts, the note is lost. *Fix:* guard the three
confirm handlers; add them to the scan test's list.

**I. The phone rail says "Left voicemail" on both calls when a number reaches voicemail twice within two
minutes** · Confirmed.
`PhonePanel.tsx:270–275` matches each row to `voicemails` independently through `voicemailForCall`, whose
window accepts a message up to 2 min *before* a call (`callVoicemail.ts:58,94`), so one message backs two
rows; the gateway arbitrates nearest-wins (`joinCallsToVoicemails`), the rail does not, and the two
disagree — the exact disagreement §5.53 §2 was closing. *Fix:* port the nearest-wins join to the rail.

### Low

**J. A manager's "Send back to pipeline" on Welcome Call / Final Confirm hides the returned patient for
15 minutes, on the queue and on the Care Coordinator column** · Confirmed. `handleLadderDone`
(`WelcomeCallPage.tsx:184–187`, `FinalConfirmPage.tsx:128–131`) calls `markAdvanced` for propose,
approve and return alike; since the claim map went global on 2026-09-25 that hide reaches the plain queue
and the dashboard. The intake page honours the "a return puts them back INTO a queue" carve-out
(`UnverifiedReferralsPage.tsx:1650–1676`); these two don't. *Fix:* have `onDone(action)` carry the
action and mark only the two that leave.

**K. Four Follow-Up modals and Evaluate's Last Visit Date use UTC "today"** · Confirmed. `min={new
Date().toISOString().slice(0, 10)}` in `welcomeCall/FollowUpModal.tsx:82`, `samantha/…:84`,
`masheke/…:84`, `profile/…:83` (today is unpickable after 8 PM ET); `EvaluatePanel.tsx:2519` `todayIso()`
feeds a future-date check at `:3078` and `max` at `:3088`. `etToday()` exists (`lib/masheke/etDate.ts`).

**L. The Care Coordinator Welcome Call column still snoozes on the Follow Up STATUS the stage page stopped
reading on 2026-09-22** · Confirmed. `careCoordinator/workflow.ts:1099` honours the date only when status
is Done; `welcomeCall/sidebarList.ts:61–66`, `useRoleCounts` and both baselines use the date alone. A row
with a future date and a non-Done status sits in Today on the dashboard and is hidden on the stage page
and in the role bar. The app's own +1 button writes both, so this needs another writer.

**M. "Generate cash-pay link" never re-checks the payer** · Confirmed. `orders/mondayWrite.ts:280` reads
only the link and action columns; release and placement re-read `COL.primaryInsurance` first
(`:212–226`). A payer corrected on the board inside the 60 s poll still gets a Stripe link minted.

**N. The dashboard's Log-attempt counter is `cached + 1`** · Confirmed. `callAttempt.ts:80,88` and
`unverifiedWrite.ts:482–484` write `n + 1` from the polled row; the notes are re-read before the append,
the counter is not, so two people logging inside one poll lose an increment. On intake the counter decides
Review Profile vs Unscheduled.

**O. Two patients sharing an email both show as Scheduled for one Calendly booking** · Confirmed. The
grid's link poisons a duplicate key (`scheduleEntries.ts:239–243`); the column buckets do a plain
`bookings.get(emailKey(item.email))` (`careCoordinator/workflow.ts:1086`, `:569`).

**P. Manual escalate toggle on Confirm Receipt / Chase is a raw write after the verified advance** ·
Confirmed, residue of audit H3/H4. `ConfirmReceiptPanel.tsx:347–351` writes Escalation after the
transaction that already flipped the sub-stage; if it throws, the catch skips `onAdvanced` (`:359`) and a
patient already in Chase stays on the Confirm Receipt screen with a live Save. `saveYes` already folds
`clearEscalation` into the transaction; do the same here.

**Q. Two softphone edge cases** · Suspected (the SDK is not in the repo, so its `disposed` behaviour is
unverified). A ring whose socket dropped is only removed on the session's `disposed` event
(`softphone.ts:768–779`); `recover()` and the socket-close handler never touch `rings`, so the card and
chime can persist, and `doAnswer` waits on `session.answer()` with no deadline where dial has 15 s and
hang-up 8 s. And a redial inside a missed card's 6-second linger can be fused into the dead card by
`ringMerge.ts:87–92` (digits fallback), so "Take it" fails and its dismissal ignores the live SIP ring.

**Doc nit.** `shared/cashPay.ts` says five slices read the marker; only `profile`, the Welcome Call OOP
card and `orders` do. Final Confirm, Subscription and the Comms Hub have no cash-pay logic. Not a bug,
just an overstatement to fix when someone is in there.

### From the recent-commits sweep (every non-automated commit since 2026-09-23, diffs read in full)

**R. The Phone tab labels real voicemails "Missed their call" until its voicemail list has loaded, and
for any call older than that list's single page** · Confirmed · Medium · regression in `396c44e`.
The new rule lets a `false` from the voicemail match override RingCentral's own result
(`PhonePanel.tsx:127` `if (hasMessage ?? r.voicemail)`); only `null` falls back. But
`AssignedPatientsPage.tsx:837` passes `voicemails.data ?? []`, turning the store's not-loaded `null`
(`rcStore.ts:40`) into an empty array, so `vmMatched` (`PhonePanel.tsx:270`) is an empty Set rather than
`null` and every voicemail row reads "Missed their call" in the rose missed styling until the fetch lands.
And `fetchVoicemails` (`ringcentralApi.ts:869–875`) is one page of 50 with no cursor over a 30-day
window; at §5.47b's measured ~2.6 voicemails a day that covers ~19 days on average, less in a busy week,
so older calls in the 14-day Calls window can read wrong permanently. A side effect: an outbound call that
reached the patient's voicemail can never match (the list is inbound only), so outbound "Left voicemail"
now reads "We called". Same code as item I; fix them together. *Fix:* pass the nullable list through so
the `null` branch fires, page the voicemail fetch the way the fax store was paged (§5.28), and let `false`
downgrade a row only when the loaded list demonstrably covers the call's time.

**S. The patient screen's swap card never refreshes after a send; `/orders` does** · Confirmed · Low.
`PatientOrderCard.tsx:370` mounts `SubstitutionCard` with no `onSent`; `OrdersPage.tsx:317` passes
`refetch`. After a send the card keeps saying "none picked" / "Send swap request" until another order is
opened. The write path re-reads the board and clears before a re-send, so this is stale display, not a
duplicate email to Cardinal. The §5.30 "one screen, not its sibling" shape.

*One caveat from the sweep, not a finding:* `6a58088`'s upsert now takes `direction` from every later
read, and `toCallRow` turns a missing direction into Outbound, so a RingCentral record ever served without
`direction` would flip a correct row on the 95-day pass. Nobody has seen RingCentral omit it; a
`direction IS NOT NULL` guard on the upsert would make the question moot.

*Commits read and found sound in this bug class:* 6a58088, 3bb7c22, 3d563dd, 208a1a3, f7d2a42, 628aeff,
32de3c0, 3cea4f3, 91612b2, 396c44e (its softphone and gateway halves), 676fd01, 32c9387, e7bbf07, 3d30f16,
3221909, and the docs-only commits. The 13 test files those commits cite pass (388 tests). One design
consequence of 208a1a3 / f7d2a42 to know about rather than fix: a coordinator holding only
`scheduledCalls` no longer gets the Welcome Call or intake doors on the patient screen; the dashboard still
deep-links her there.


### Checked and found sound (so nobody re-reviews it in the morning)

- **Counting contract (§5.8):** `useRoleCounts` matches both baseline generators role by role, including
  the DVS-stage exclusion, escalation sets, snoozes and the chase split; the two generators differ only in
  header, endpoint and commit helper. `welcomeCallSnooze`, `chaseMethods` and `intakeSubStage` tests scan
  the generators for the literals, so they pin filters, not shape. The Insurance and DVS rules match today
  but nothing scans them.
- **Intake split:** every state of {1. Intake, in-system group, two form groups, Clean-Up} × {Already In
  System Yes/No/blank} lands in exactly one page and one count.
- **Oversight:** 38 test files, 639 tests pass; `columnExclusivity` and `insuranceCoverage` pin the
  partitions at every escalation rung. Cash pay adds no escalation state.
- **Insurance hide gate:** `stageLeavesQueue` maps `benefitsSos` / null correctly on all three pages.
  Masheke `onAdvanced` fires only when a stage was written. Profile's three exits all leave the group.
- **Cash pay after intake:** Welcome Call's send validation has no insurance/auth gate; a blank Serving
  defaults to no sale; `markOrdered` and `releaseCashPayOrder` re-read payer and payment columns.
- **`expectedText` pairs** that exist all name the label their write carries (masheke "Done" ↔ index 1,
  Clean-Up ↔ the read-back map, both Move to Onboarding writers from one decider, Evaluate's `nextStage`
  ↔ `SUB_STAGE_LABEL`). Not verifiable from source: the board spelling behind "No Auth Needed".
- **Can Text:** blank is treated as unknown everywhere traced; opt-out fails closed on an incomplete
  history. **Drafts:** every notes/message draft traced is keyed on the patient or reset on change.
  **Dates on the Care Coordinator page:** `followUpHorizon`, `classifyBooking`, `daysBetween`,
  `createdDayEt` are all ET date-part safe. **Faxes** are filtered out of every voice read and count.

---

## 4. Suggested morning order

Cursor's numbers are its items; letters are §3's.

1. **#1** — decide the fix (stage-scoped claim, above) and ship it with a test per hook. Verify: Evaluate →
   `/send-request` immediately; Benefits → `/submit-auth`; Welcome Call → `/final-confirm`; Info Collection →
   Clean-Up, then the Care Coordinator column.
2. **A + #3 + #12** — one family: route Medical Evaluation items by stage in `dossierApi.routeFor`, make each
   masheke panel refuse a send when the item's sub-stage is not its own, and wire
   `reviewMode = !!useCompletedStageReview(selected?.id)` on the six tool pages. Verify: open a Chase
   patient from the Fax panel (lands on Chase, not Evaluate); open Send Request on a Completed ME item
   (stage actions dead).
3. **#2** — Josh decides clear-Primary vs General-only; either is a few lines in `cashPayIntake.ts` plus the
   page test. Verify both directions: Cash Pay → Aetna shows section 1 and says MN; plain Cash Pay still →
   Welcome Call.
4. **B** — `refusePendingNote()` at the top of Send Request's two send paths; fix the scan test.
5. **#4 + D** — same file: refuse `doDial` and `takeOver` while a non-ignored ring exists.
6. **C** — `Paid Cash` with a blank CAH Order Number is To place, in `orderStage`, the hook and both
   generators together. The headline is wrong today; the missing button matters the day the ordering flag
   flips.
7. **#14, #7, H, E** — small and self-contained.
8. **#6, #8, #9, #11, #5b, F, G, I + R, J, K** — small; as time allows. #5b/G share a fix, and I + R are one edit in `PhonePanel`.
9. **#13** — after launch, with each board's label text read back from `settings_str`.
10. **#10, L–Q, S** — leave documented; none moves a patient.

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
