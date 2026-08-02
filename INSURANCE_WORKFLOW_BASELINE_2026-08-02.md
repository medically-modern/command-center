# Insurance workflow — BASELINE SNAPSHOT (pre-change)

**Anchor commit:** `1d0e40e08a7dfb13e785f0d0bf85d05c087f998c` ("Update access config")
**Captured:** 2026-08-02 · branch `claude/insurance-workflow-baseline-641z8s`
**Test baseline:** `npm test` → **54 files / 623 tests, all passing** (15.5s)

This is a *description of current behavior*, not a spec or a proposal. Its only job is to be
the "before" side of a diff after the insurance workflow is reworked — so that at the end we
can say precisely what changed, what behavior that produced, and what moved that nobody
intended to move. Where current behavior is odd, it is recorded **as-is** and flagged in §10
so a pre-existing quirk is never mistaken for a regression introduced by the changes.

---

## 0. Scope

"Insurance workflow" = the **Insurance ("Samantha") board `18410601299`** and everything the
SPA does with it: five roles (`benefits`, `submitAuth`, `authOutstanding`, `dvs`,
`authDenied`), their pages/panels, the shared read/derive/write library under
`src/lib/samantha/`, the DVS monitor, the manager/oversight surface pointed at this board,
and the counting contract that feeds burndown.

Explicitly **out of scope** (upstream/downstream, untouched here): Profile Send Off, Medical
Evaluation (Masheke), Welcome Call, Subscription/Claims. They are named only where they feed
or consume Insurance columns.

---

## 1. File inventory at baseline

Line counts are recorded so a later diff shows movement at a glance.

### 1.1 Live — domain library (`src/lib/samantha/`)

| File | LOC | Role |
|---|---:|---|
| `mondayWrite.ts` | 1411 | The send transaction for all 3 rep stages + 2 partial-save paths |
| `mondayApi.ts` | 978 | `COL` map, board/group ids, read column sets, GraphQL primitives |
| `workflow.ts` | 707 | `Patient`/`InsuranceState` types, `deriveInsuranceOutcome`, next-order math |
| `benefitsDerive.ts` | 623 | SoS derivation, ET date helpers, gating, escalation level, board preview |
| `mondayMapping.ts` | 520 | Monday item → `Patient`; all status-index maps |
| `hcpcRules.ts` | 330 | Payer × Serving → products + HCPCs + Medicaid routing |
| `submitAuthRules.ts` | 230 | Card selection, submit gating, modifiers, MLTC, BCBS home plan |
| `authOutstandingReview.ts` | 228 | Tracked cards, SoS recheck, complete gating, daily-bucket snooze |
| `managerIdentityEdit.ts` | 176 | Pure diff/note/product-impact for the manager profile edit |
| `sidebarList.ts` | 142 | Sidebar section math (shared with page auto-select) |
| `managerRail.ts` | 134 | Oversight-bar → page-sidebar narrowing predicates |
| `medicareJurisdiction.ts` | 103 | MAC jurisdiction pill + `isMedicarePrimary` / `isMedicareABOnly` |
| `dvsRouting.ts` | 106 | CIN gate, all/has-DVS-routed, auto-trigger choice |
| `authOutstandingDays.ts` | 72 | Days-outstanding (live compute, board column fallback) |
| `authFaxTemplate.ts` | 67 | Fax-to-payer subject + cover letter |

Tests (all passing): `benefitsDerive` 55 · `managerIdentityEdit` 23 · `sidebarList` 21 ·
`authOutstandingReview` 18 · `managerRail` 17 · `submitAuthRules` 14 · `authOutstandingDays` 12 ·
`dvsRouting` 11 · `medicareJurisdiction` 11 · `universalRoundTrip` 9 · `dvsRail` (pages) 7 ·
`authFaxTemplate` 5. Adjacent oversight tests: `reasonBuckets` 17 · `managerViewCols` 5 ·
`fuzzyName` 6.

### 1.2 Live — pages & components

| File | LOC |
|---|---:|
| `src/pages/ChaseBenefitsPage.tsx` (route `/benefits`) | 326 |
| `src/pages/SubmitAuthPage.tsx` | 311 |
| `src/pages/AuthOutstandingPage.tsx` | 322 |
| `src/pages/DvsPage.tsx` | 566 |
| `src/hooks/samantha/useMondayPatients.ts` | 223 |
| `src/hooks/dvs/useDvsPatients.ts` | — (read-only monitor hook) |
| `components/samantha/AuthOutstandingPanel.tsx` | 721 |
| `components/samantha/BenefitsPanel.tsx` | 679 |
| `components/samantha/AuthorizationsPanel.tsx` | 600 |
| `components/samantha/PatientProfileCard.tsx` (DVS page only) | 482 |
| `components/samantha/AuthFaxPanel.tsx` | 276 |
| `components/samantha/PatientsSidebar.tsx` | 270 |
| `components/samantha/ManagerIdentityEditDialog.tsx` | 233 |
| `components/samantha/FinalClinicalsUpload.tsx` | 223 |
| `components/samantha/BenefitsPatientHeader.tsx` | 185 |
| `components/samantha/ProposeStuckButton.tsx` | 168 |
| `components/samantha/NotesPanel.tsx` | 159 |
| `components/samantha/ClinicalsDownloadButton.tsx` | 115 |

### 1.3 DEAD at baseline (zero live importers — verified 2026-08-02)

`InsurancePanel.tsx` (886 LOC — the pre-redesign combined panel), `DoctorRequestPanel`,
`PathwayPanel`, `PillarsChecklist`, `PatientCard`, `FollowUpModal`, `EscalateButton`,
`SendToMondayButton`.

Dead **exports** still living in live files: `workflow.validateBenefitsForSubmit` (superseded by
`benefitsDerive.validateBenefitsFactsForSubmit`), `workflow.PATHWAYS` / `PILLARS` /
`UNIVERSAL_CHECKS` / `STAGE_LABELS` (Masheke-era leftovers reachable only from dead components),
`mondayMapping.STAGE_TEXT_TO_GROUP`, `mondayMapping.parseAuthResultLabel`.

> `ClinicalsDownloadButton` is imported by the **dead** `profile/StediPanel.tsx` *and* by three
> live insurance surfaces. Don't delete it in a dead-code sweep.

---

## 2. Board topology

- **Board:** `18410601299` (Insurance / "Samantha").
- **Groups** (`mondayApi.GROUPS`): `benefits group_mm1xr3q3` · `submitAuth group_mm1x1416` ·
  `authOutstanding group_mm2v6d1z` · `complete group_mm2vw3c0`. The **Auth Denied** group
  (`group_mm316hg2`) is referenced only by the oversight chart filter, not by `GROUPS`.
- **Stage Advancer** `color_mm1ws96t` — the ONE column Monday automations key on.
  `STAGE_INDEX`: `authDenied 0 · dvs 1 · stuck 2 · benefitsSos 3 · authorization 4 ·
  authOutstanding 6 · complete 7` (index 5 unused).
- **DVS has no group.** Stage-DVS items stay wherever their last group automation left them, so
  every group read and every group count filters `stageAdvancerText !== "DVS"`, and the DVS
  surfaces query **board-wide by stage index 1** instead.

### 2.1 Roles → routes

| Role id | Label | Route | Notes |
|---|---|---|---|
| `benefits` | Benefits | `/benefits` | page file is `ChaseBenefitsPage.tsx`; `/chase-benefits` redirects |
| `submitAuth` | Submit Auth | `/submit-auth` | |
| `authOutstanding` | Auth Outstanding | `/auth-outstanding` | |
| `dvs` | DVS | `/dvs` | read-only monitor, stage-based (no group) |
| `authDenied` | Auth Denied | `/auth-denied` | **count-only** — no App.tsx route; bar deliberately not clickable (`DailyBurndown`, `OperationsTab`) |

---

## 3. Read path (identical for all three rep stages)

`useMondayPatients(group)` → `fetchGroupItems(GROUPS[group])` → `mondayItemToPatient` →
overlay merge → state.

- **Poll:** 30s, silent. First fetch blocks the page behind `PageLoadingOverlay`
  (`initialLoading`), independent of the localStorage cache.
- **Column sets:** `READ_COLUMN_IDS` for Benefits; `AUTH_READ_COLUMN_IDS` (= base + auth results,
  per-product submission fields, DVS bot columns, days columns) for Submit Auth / Auth
  Outstanding. Pagination uses the **same** column set on page 2+.
- **Local overlay:** `localStorage["sam-overlays"]`, per patient id, **deep-merged per product
  code** so a Monday-only field (`_mondayAuthLabel`, methods, dates) survives a group switch.
  Patient cache is namespaced per group (`sam-patients-cache:<group>`).
- **Deep link:** `?patientId=` not in the group is fetched individually
  (`fetchItemById`, auth columns for `submitAuth` **and** `authOutstanding`).
- **DVS filter:** `.filter(p => p.stageAdvancerText !== "DVS")` on every group read.

### 3.1 Hydration rules worth remembering (`mondayMapping.mondayItemToPatient`)

- Universal checks parse **by status index, not label text** (`parseUniversal`) — a board rename
  can't break the round-trip. In-Network `color_mm2vhwan`: 1 = In-Network, 2 = Out-of-Network,
  **11 = "Medicare not Primary"**. Active `color_mm5q9y3`: 1/2. DME `color_mm2vt8xg`: 1/2.
- Per-product auth label → internal `auth`: `Required | Submitted | Auth Valid | Denied` all
  collapse to `auth: "required"`; `No Auth Needed` → `not-required` + `sos: "clear"`;
  `Not Serving` → blank. The **verbatim** label is preserved as `_mondayAuthLabel` and is what
  card-selection and the Submit-Auth write actually gate on.
- Per-product SoS: `notClearProducts` / `skipSosProducts` dropdowns are canonical and overlay
  whatever the auth label implied. SoS **facts** (`sosLastBill` / `sosUnits` / `sosNeverBilled`)
  hydrate on top of the legacy `lastBillDate` and set `sosEntry` to `billed` / `never`.
- Medicare A&B rollups (`neverBilledIsCar` / `neverBilledCgm`) seed per-product `sosEntry:"never"`
  for IS+Cartridges / Sensors respectively. **Known gap:** non-Medicare "never billed" facts have
  no board expression beyond the per-product checkboxes, so they only round-trip via those.
- `escalated` = label is `Manager Escalation Required` **or** `Final Escalation Required`;
  `escalationLabel` keeps the raw string (the manager sidebars need to tell them apart).
- Carecentrix Intake ID and Call/Fax Number are **single shared columns** fanned out to every
  product code on read.
- Hardcoded/vestigial: `product: "CGM"`, `stage: "advanced"`, `owner: "Samantha"`,
  `contactMethod: "parachute"`, `receivedAt`/`lastUpdated` = now.

---

## 4. Write path

Everything goes through `sendPatientToMonday(patient, context, {onProgress})` where context is
`"benefits" | "submitAuth" | "authOutstanding"`, plus two narrow partial-save paths.

- **Protocol:** `executeWritesWithVerification` (snapshot → write-all-parallel-with-retry →
  read-back verify → *then* Stage Advancer). Per-task retry = 2 (800ms × attempt). Failures are
  logged to Josh Debug `text_mm2w1qn4` and the send **throws**.
- **`requireDone` is NOT used** by any insurance path — "gateway accepted" is treated as success
  (unlike Chase Clinicals / Confirm Receipt).
- **`expectedText` is set on almost nothing.** Only: the "TBD" Medicare prior-pump-date write,
  `saveNoAuthNeededToMonday`'s auth-result, and every task in `saveManagerIdentityEdits`.
  Everything else relies on the snapshot-diff fallback (3 stable reads ⇒ "same-value write, fine").
- **All three pages block the UI** during the send with `SaveProgressOverlay` and clear the
  overlay on success.

### 4.1 Unverified single writes (deliberate, no stage impact)

| Action | Write |
|---|---|
| NotesPanel "save to Monday" (all 3 pages + DVS) | `writeLongText(callReferenceNotes)` |
| "Auth Still Outstanding" (Auth Outstanding) | `writeDate(followUpDate, today+1)` |
| DVS "Re-run" buttons | `writeStatusIndex(triggerDvs / triggerPumpDvs, 1)` |
| Propose Stuck | notes append, **then** escalation status (sequential, notes first) |
| Approve Stuck / Return to Queue / Escalate-to-Final | sequential writes on the Insurance board |

---

## 5. Stage behavior

### 5.1 Benefits (`/benefits`, `ChaseBenefitsPage` + `BenefitsPanel`)

**Rep records facts only.** Step 1 = three universal checks. Step 2 = per visible product,
Auth Required/Not Required + billing history (Last Bill Date + Units **or** "No Billing
History"). Two append-only call logs. **Clear / Not Clear / Skip is never shown or picked.**

Header is **read-only** (`BenefitsPatientHeader`) except the manager-only Edit profile (§7.3).
No Escalate button, no Follow Up button, no Trigger DVS buttons — all removed by the redesign.

**Derivation (`benefitsDerive`):**
- `derivedSos`: `auth = required` → **skip** (entered date/units ignored) · `sosEntry = never` →
  **clear** · billed & `lastBillDate < cutoff` → **clear** · billed & `>= cutoff` → **not-clear**
  (strict `<`; a bill exactly on the cutoff is NOT clear) · else `""`.
- `sosLookbackDays`: pump **E0784** and monitor **E2103** = 5 yr if `isMedicarePrimary` else 4 yr
  (365-day multiples: 1825 / 1460). Sensors / IS / Cartridges = 90 d, or **60 d** when either
  insurance string contains "medicaid".
- `deriveNeverBilled`: gated on `primaryInsurance === "Medicare A&B"` **exactly**. `isCar` = IS
  AND Cartridges both never-billed; `cgm` = Sensors never-billed; `pumpDateTbd` = `isCar`
  (the pump's own entry is NOT consulted).
- Medicaid + Serving "Insulin Pump" pre-fills pump `auth: "required"` (overridable) — which then
  derives SoS = Skip and pushes the pump into the Skip dropdown for the Auth Outstanding recheck.

**Gating (`validateBenefitsFactsForSubmit`):** Serving + Primary Insurance present · all 3
universal checks answered (a *negative* answer passes gating) · if In-Network =
"Medicare not Primary", a non-empty universal call note naming the real primary · then, only if
no negative check, every visible product needs Auth + a complete SoS entry (date **and** integer
units > 0, or Never Billed, or auth-deferred).

**Send outcome:**

| Condition | Stage Advancer | Escalation |
|---|---|---|
| any universal negative (`not-confirmed` or `medicare-not-primary`) | `benefitsSos` (3) | `universalEscalationLevel`: In-Network negative → **Final**; DME `not-confirmed` → **Final**; Active negative alone → **Manager** |
| pump derived SoS = not-clear (checks all pass) | `benefitsSos` (3) | **Manager** |
| incomplete | `benefitsSos` (3) | Done |
| all clear | `complete` (7) | Done |
| any auth required | `authorization` (4) | Done |
| ...and `allProductsDvsRouted` (and not blocker/incomplete) | overridden to `dvs` (1) + auto trigger | Done |

**Failed-check path (`universalNegative`, benefits context only):** step 2 never ran, so the
send writes **only** the universal columns + Escalation + Stage Advancer + notes/call-log/profile
fields. Every per-product column, both dropdowns, all three next-order dates, the SoS facts
family, the never-billed rollups and the TBD pump date are **left untouched**. The
`deriveBenefitsPreview` drawer blanks the same fields so the preview matches.

**Escalation is DERIVED ONLY here** — `manualEscalate` is explicitly `context !== "benefits" &&
p.escalated`, so fixing the facts and re-sending genuinely de-escalates a patient.

**Auto-escalation reason** (`composeEscalationReason`) is appended to Call Reference Notes as
`[Auto-escalated · YYYY-MM-DD · <initials>] <reason>; <reason>`, deduped against existing text.

**Landing at DVS** also flips a bot trigger (`dvsAutoTrigger`): pump trigger for straight-Medicaid
pump patients, else the supplies trigger.

### 5.2 Submit Auth (`/submit-auth`, `AuthorizationsPanel` + optional `AuthFaxPanel`)

One card per product whose **board label is exactly "Required"** and that isn't DVS-routed
(`submitAuthCards` — deliberately gates on `_mondayAuthLabel`, not the collapsed internal `auth`).
Above it, a read-only Auth-Status matrix for all 5 products. No SoS UI.

Per card: Submission Method (`Availity Portal | Payer Portal | Call | Fax`), Call/Fax number when
Call or Fax, Submission Date, optional Auth ID; modifier chips from a payer-keyed route table
(`anthem-803` / `carecentrix` / `bcbs-tn` / default — a hand-synced copy of claims-ui-tool);
Carecentrix Intake ID shown for Horizon BCBS + Payer Portal. MLTC banner when Stedi Plan Name
matches `/MLTC/i` (tip only, never forces Fax). BCBS home ≠ host banner from `authHomePlan`.
A "Fax to Payer" tab appears only when some card's method is Fax; it is **send-only** and does not
record or advance.

**Gating:** every card needs Method + Submission Date (+ number for Call/Fax). Zero cards ⇒ send
allowed.

**Send outcome:** Stage → `allProductsDvsRouted ? dvs(1) : authOutstanding(6)`. Follow Up **Date**
is always stamped **today (ET)** — same-day, not +1 — which is the prerequisite for the Auth
Outstanding daily bucket. The Follow Up **status** column is left alone. Per-card products flip
`Required → Submitted`, but only when the board label is still literally "Required"; Medicaid-routed
supplies are skipped so they stay Required for the DVS automation. Escalation follows the hydrated
`p.escalated` flag only.

### 5.3 Auth Outstanding (`/auth-outstanding`, `AuthOutstandingPanel`)

Daily-check workflow. Cards are "tracked" when the board label is **"Submitted"**, or
**"No Auth Needed" while still SoS-deferred** (in the Skip dropdown) — the partial-save case.
DVS-routed products never get a card.

Per card, one result: **Auth Valid** (needs Auth ID + Start + End + Units) · **Denied**
(denial upload optional, never gates) · **No Auth Needed** (needs the SoS recheck facts; Clear /
Not-Clear is derived by `derivedRecheckSos`, never shown). "Save No Auth Needed" partial-saves
just that product (`saveNoAuthNeededToMonday`): writes the result + clears that product's Auth
ID/Start/End/Units, `stageColumnId: []` ⇒ **no stage move, no escalation**.

Header carries a live **"N days outstanding"** badge — `daysAuthOutstanding` computed from the
**earliest** per-product Auth Submission Date, falling back to the cron-maintained board column
`numeric_mm5f5ars`; amber < 14, red ≥ 14.

**"Auth Still Outstanding"** = one unverified write: Follow Up Date → tomorrow. Nothing else.

**Send outcome (`Auth Review Complete`, priority order):**
1. any non-DVS product `denied` → stage `authDenied` (0) + Escalation **Manager** (forced).
2. all non-DVS products resolved → `hasDvsRoutedProducts ? dvs(1) : complete(7)`.
   *Resolved* = `auth === "not-required"`, or result `auth-valid`, or result `no-auth-needed`
   with a recorded recheck (`sosRecheck` set, or `sos !== "skip"`).
3. every product DVS-routed → `dvs(1)`.
4. otherwise **no Stage Advancer write** (partial save; patient stays put).

The recheck SoS is **recomputed at send time** against today's ET cutoff, so a Friday-entered
fact sent on Monday derives against Monday. Recheck facts write only for products whose
effective result is `no-auth-needed` — this block never clears facts Benefits wrote for others.

### 5.4 DVS (`/dvs`) — read-only monitor

Board-wide fetch of Stage Advancer index 1. Escalated DVS patients are **included** (Josh
2026-07-29). Snoozed iff Follow Up Date is in the future. `isManualReview` = a rose
Supplies/Pump DVS status (MLTC / Failed / Manual Review / Denied) or a claims failure —
**status-only**, the Escalation column is deliberately not consulted. `isQueued` = literal status
`"Retry Queued"` (not `retryCount > 0`). The only writes are the two Re-run trigger buttons and
Reference Notes. DVS runs on the **CIN** (`^[A-Za-z]{2}\d{5}[A-Za-z]$`) from Member ID 1 or 2;
**no CIN ⇒ no DVS routing at all**.

### 5.5 Auth Denied

Count-only. Reached by stage index 0 / group `group_mm316hg2`. No page, bar not clickable.

---

## 6. Shared derivation rules

**`resolveHcpcs(primary, serving, secondary)`** — the spine. Serving → product list; payer →
supply HCPC group (A: A4230/A4232 · B: A4224/A4225 · C: A4231/A4232, Aetna only); supplies route
to **Medicaid** when primary is `Medicaid`, or when primary is `Fidelis Medicaid` /
`Anthem BCBS Medicaid (JLJ)` **and** secondary is `NY Medicaid`. Unknown payer ⇒ HCPC `"Evaluate"`.
`isAutoFilledMedicaidSupply` = infusion_set/cartridge billing to Medicaid — these are **hidden
everywhere in the UI**, auto-filled Auth=Required/SoS=Clear at Benefits, and skipped by Submit
Auth and Auth Outstanding.

**Next order dates** (written from Benefits only): IP = pump last bill + 5 yr (Medicare primary)
or 4 yr · Sensors = last bill + **30/60/90** days for 1/2/3+ units · Supplies = max(IS, cartridge)
last bill + 90 d (60 d with Medicaid). A Skip product contributes **nothing**.

**`isMedicarePrimary`** = `/^Medicare A&B/i` on primary (secondary irrelevant).
**`isMedicareABOnly`** = that, AND no meaningful secondary — gates the "Medicare not Primary"
third answer and the MAC jurisdiction pill.

---

## 7. Escalation & manager surface

### 7.1 The column
Insurance Escalation `color_mm2vsh2f`: **0 = Manager Escalation Required · 1 = Done ·
2 = Final Escalation Required**.

### 7.2 How a patient gets there
- **Auto, Benefits:** `universalEscalationLevel` (§5.1) or pump SoS not-clear → Manager.
- **Auto, Auth Outstanding:** any denial → Manager.
- **Manual:** `ProposeStuckButton` — stamps `[Proposed Stuck · date · initials] reason` into
  Reference Notes **first**, then flips escalation. `escalateTo` is **"manager" at Submit Auth**
  (two-step review) and **"final"** at Benefits / Auth Outstanding. Stage Advancer untouched.
- **Manager promotion:** `escalateSubmitAuthToFinal` (note required, idempotent) → Final.

### 7.3 Manager actions
`StageActionBar` resolves buttons per (stage × `?mv=` origin) via `stageActions.ts`: rep &
overview & manager-intervention → `[proposeStuck]`; **final-decisions → `[approveStuck,
returnToQueue]`** (Propose Stuck deliberately dropped).
- `approveInsuranceStuck` → optional stamped note, Stage → **Stuck (2)**, then clear escalation.
- `returnInsuranceToQueue` → optional stamped note, **Follow Up Date → today**, then clear
  escalation (the re-date is what makes a return actually land in the pure-date Auth Outstanding
  bucket).
- **Manager profile edit** (`BenefitsPatientHeader managerEdit`, only when
  `?mv=manager-intervention|final-decisions`): Serving · Primary/Secondary Insurance ·
  Member ID 1/2. Dropdowns + `expectedText` come from **live board labels** (`fetchStatusOptions`),
  only changed fields are written, `stageColumnId: []`, and the dialog previews the
  `resolveHcpcs` product delta before committing.

### 7.4 Oversight charts (`lib/oversight/oversightApi.ts`)
Insurance stage: primary `benefits · submit-auth · auth-outstanding · auth-denial` (Processor
Overview — **excludes** escalation index 0 and 2); secondary (Manager Intervention)
`benefits-manager-escalation` (buckets: Inactive insurance · Pump SoS · Check outstanding >5d)
and `submit-auth-manager` (buckets: DVS Retry · DVS Manual Review · Propose Stuck); tertiary
(Final Decisions) `benefits-final-escalation` (buckets: Propose Stuck · Universal Check),
`submit-auth-final-escalation`, `auth-outstanding-final-escalation`.
`managerRail.ts` re-expresses every one of those bucket rules against the samantha `Patient`
model so the page sidebar matches the clicked bar; `managerRail.test.ts` guards the pairing.

---

## 8. Counting contract (§5.8 of CLAUDE.md) — current rules

Four implementations must agree: `useRoleCounts.samActive/countDvs`,
`scripts/snapshot-baseline.mjs`, `services/baseline-cron/index.mjs`, and
`sidebarList` / `useMondayPatients`.

- Escalated = `{Manager Escalation Required, Final Escalation Required}`; escalated patients are
  excluded from a role's **active** count and reported separately.
- **Benefits / Submit Auth** snooze: Follow Up **status** = "Follow Up" AND (no date OR date >
  today ET).
- **Auth Outstanding** snooze: **pure date** — `followUpDate > today`; status ignored; blank = due.
- **DVS**: board-wide stage index 1, date-only snooze, **escalated INCLUDED**, escalated count
  reported as 0 so the "all" view can sum active + escalated without double-counting.
- Every group count drops `Stage Advancer === "DVS"`.
- `baseline-cron` additionally recalcs **Days Auth Outstanding** `numeric_mm5f5ars` daily
  (idempotent; mirrors `authOutstandingDays.ts`; `SKIP_DAYS_RECALC=1` disables).

---

## 9. Column inventory (the contract most likely to drift)

Universal: In-Network `color_mm2vhwan` · Active `color_mm5q9y3` · DME `color_mm2vt8xg` ·
SoS aggregate `color_mm2vemyy` · Auth aggregate `color_mm2vg3ew`.
Flow: Stage Advancer `color_mm1ws96t` · Escalation `color_mm2vsh2f` · Escalation Notes
`long_text_mm3jrssp` · Not Clear Products `dropdown_mm2vez5a` · Skip SoS Products
`dropdown_mm31163t` · Follow Up `color_mm34jz1x` + date `date_mm34m2dz` · Days Since Stage
`color_mm1wwm05` · Days Auth Outstanding `numeric_mm5f5ars`.
Notes / shared: Call Reference Notes `long_text_mm2ffsme` · Carecentrix Intake ID `text_mm2wnhx` ·
Call/Fax Number `text_mm2yd7st` · Josh Debug `text_mm2w1qn4` · Final Clinicals `file_mm25m8c1`.
Benefits-redesign columns present but **not written by the send**: `benefitsCallLog
long_text_mm59y5xt`, `sosAuthCallLog long_text_mm59rz2c` (both call logs go to Call Reference
Notes instead — Josh 2026-07). `medicarePriorPumpDate text_mm59qh8r` gets the literal `"TBD"`.
Identity: Serving `color_mm1w1cm9` · Primary `color_mm1x157j` · Secondary `color_mm241kqp` ·
Member ID 1 `text_mm1x2qk2` / 2 `text_mm1xaccx` · Diagnosis `color_mm1wf7rv`.
Per-product ×5 families: `authResult` · `authMethod` · `authId` · `authSubmissionDate` (**text**) ·
`authStart` / `authEnd` (date) · `authUnits` (numeric) · `lastBillDate` (legacy, date-presence
encodes Not-Clear downstream) · `sosLastBill` · `sosUnits` · `sosNeverBilled` (checkbox).
Next order: IP `date_mm35aknj` · Sensors `date_mm35f5j1` · Supplies `date_mm35da3j`.
Never billed: IS/Car `color_mm3zjyya` · CGM `color_mm3zg2pn`.
Triggers/bot output: Trigger DVS `color_mm26pk1a` · Trigger Pump DVS `color_mm578kbd` · Claims
Status `color_mm284z0b` · retry/claim/denial text columns per `COL`.
Stedi (read-only): Plan Name `dropdown_mm2w11t4` · Home Plan `dropdown_mm5ex8wx` · QMB
`text_mm2wabwr` · Coinsurance `text_mm39k0hz` · Plan Begin `text_mm3ggbwa` · Deductible
`text_mm1xdzxw` · OOP Max `text_mm1xx5f`.

`AUTH_RESULT_INDEX`: evaluate 0 · authValid 1 · denied 2 · noAuthNeeded 3 · submitted 4 ·
required 6 · notServing 7. `AUTH_METHOD_OPTION_ID`: Availity 1 · Fax 2 · Payer Portal 5 · Call 6.
`NOT_CLEAR_PRODUCT_ID` = `SKIP_SOS_PRODUCT_ID` = pump 1 · monitor 2 · sensors 3 · IS 4 · cartridges 5.

---

## 10. Pre-existing quirks at baseline — NOT caused by the upcoming changes

Recorded so they can't be misattributed later. None are being fixed as part of this snapshot.

1. **Per-product auth submission fields are queued twice per send.** `mondayWrite.ts` has two
   near-identical blocks (≈L831–892 and ≈L992–1065) that both push method / submission date /
   auth ID / start / end / units for every entry. Same values, doubled task count and doubled
   verification work.
2. **Final escalation is silently downgraded to Manager** by any Submit Auth or Auth Outstanding
   send. `escalationDecision` starts at `manualEscalate ? "manager" : "done"` and nothing in
   those contexts can produce `"final"`, so sending a Final-escalated patient rewrites index 2 → 0.
3. **The send rewrites the read-only header back to Monday.** Name, DOB, Primary Insurance,
   Member IDs, Secondary, Diagnosis, all doctor fields, Clinic Name, phone and address are written
   on *every* send from *all three* contexts, from hydrated values the rep can't edit.
4. **Almost no `expectedText`.** Verification for most tasks degrades to the snapshot-diff
   fallback, which treats a silently-failed same-value write as success.
5. **`PRIMARY_INSURANCE_INDEX` has drifted from the board**: it carries
   `"United Healthcare Commercial": 7` and `"Fidelis CHP": 110`, neither of which is in the
   `PrimaryInsurance` union (the map is cast), and `"United Low-Cost": 10` deliberately aliases
   United Commercial. `PRIMARY_INSURANCE_OPTIONS` spells `"MagnaCare"` where the board says
   `"Magnacare"`. This is exactly why the manager edit dialog reads live labels instead.
6. **Non-Medicare "No Billing History" round-trip is partial** — only the per-product
   `sosNeverBilled` checkboxes carry it; the Medicare rollups are the only aggregate expression.
7. **Two dedicated call-log columns exist but are dead** (`long_text_mm59y5xt`,
   `long_text_mm59rz2c`) — both logs are appended to Call Reference Notes instead.
8. **`GROUPS` omits the Auth Denied / Escalations / Stuck groups** that the board has; only the
   oversight filter knows the Auth Denied group id.
9. **"Monday Board Output" testing drawers still ship** in `BenefitsPanel` and
   `AuthorizationsPanel` (both specs say delete before production).
10. **`InsurancePanel.tsx` (886 LOC) is dead** but is the only consumer of
    `deriveInsuranceOutcome`'s UI-facing shape, `UNIVERSAL_CHECKS`, and `computeNextOrderDates`'
    component usage — deleting it changes nothing on screen.
11. **`resolveHcpcs` returning `"Evaluate"`** for an unmapped payer flows into card headlines and
    `modifiersFor` returns null for it — no explicit UI handling.
12. **Overlay persistence is manual.** Edits live in memory + `sam-overlays` only when the rep
    presses Save; Reset clears the overlay and refetches.

---

## 11. Behavioral re-check list (run this after the changes)

Each line is an observable that this baseline pins down. Any difference is either an intended
change or a snowball effect.

**Benefits**
- [ ] 3 universal answers survive a reload (index-based round-trip, incl. Medicare not Primary).
- [ ] Medicare-A&B-only patient shows the third In-Network answer + MAC pill; a non-Medicare
      patient shows Out-of-Network; switching payer clears a now-unreachable answer.
- [ ] Bill exactly on the cutoff derives **Not Clear**; one day earlier derives Clear.
- [ ] Auth Required blanks/ignores the billing-history inputs and derives Skip.
- [ ] Negative check → step 2 gates off, send button reads "Submit — Escalation Required",
      per-product columns untouched, correct Manager-vs-Final split.
- [ ] Pump SoS not-clear alone → Manager escalation, stage stays Benefits / SoS.
- [ ] Fixing facts and re-sending **de-escalates** (writes Done).
- [ ] All-DVS-routed patient with a valid CIN → stage DVS + correct trigger column.
- [ ] Next-order dates: 1 unit → +30 d, 2 → +60 d, 3+ → +90 d on sensors; Medicaid supplies 60 d.

**Submit Auth**
- [ ] Cards appear only for board label exactly "Required"; Medicaid supplies never get one.
- [ ] Call/Fax method demands a number; send blocked until Method + Date on every card.
- [ ] Send stamps Follow Up **Date = today** and flips Required → Submitted (not the supplies).
- [ ] MLTC banner keys off Plan Name only; BCBS home-plan banner only when first words differ.
- [ ] Zero cards → send allowed → stage Auth Outstanding (or DVS if all-DVS).

**Auth Outstanding**
- [ ] Days-outstanding badge matches earliest Auth Submission Date; falls back to the column.
- [ ] "Auth Still Outstanding" moves the patient out of today's bucket and back tomorrow.
- [ ] "Save No Auth Needed" persists one product and does **not** move the stage.
- [ ] A partial-saved No-Auth-Needed card comes back open with the recheck still pending.
- [ ] Denial → stage Auth Denied + Manager escalation; all resolved → Complete (or DVS).
- [ ] Partial state → **no** Stage Advancer write.

**DVS**
- [ ] Escalated DVS patients are listed and counted; future Follow Up Date hides them.
- [ ] "Retry Queued" is the only thing that reads as queued; rose statuses read manual review.

**Cross-cutting**
- [ ] Role-bar counts == sidebar lengths for all four roles (the four-implementation contract).
- [ ] Oversight bar count == that bar's sidebar length after click-through (managerRail pairing).
- [ ] ~~Manager profile edit still writes only changed fields and previews the product delta.~~
      *(obsolete — feature removed, see change log below)*
- [ ] `npm test` still green, and the count moved only by tests intentionally added/removed
      (baseline: **54 files / 623 tests**).

---

## 12. Change log — deltas against this snapshot

Appended as the rework lands. §0–§11 above are frozen at `1d0e40e` and deliberately
**not** edited, so they stay a faithful "before".

### 2026-08-02 · Manager "Edit profile" removed from the Insurance manager views

**What changed.** The manager-only identity edit is gone. `BenefitsPatientHeader` is now read-only
for everyone, on all three Insurance pages and in every oversight origin.

Deleted: `components/samantha/ManagerIdentityEditDialog.tsx`, `lib/samantha/managerIdentityEdit.ts`
(+ its 23 tests), `saveManagerIdentityEdits` in `lib/samantha/mondayWrite.ts`, samantha's
`fetchStatusOptions` / `StatusOption` / `statusOptionsCache` in `lib/samantha/mondayApi.ts`, and
`isManagerEscalationView` in `lib/shared/managerOrigin.ts`. All were exclusive to this feature —
the other three `fetchStatusOptions` implementations (masheke, finalConfirm, shared) are untouched.
`BenefitsPatientHeader` lost its `managerEdit` / `stage` / `onIdentitySaved` props; the three pages
now render `<BenefitsPatientHeader patient={selected} />`.

**Resulting behavior.** A manager arriving from Manager Intervention or Final Decisions sees the
same read-only header a rep sees. The remaining manager actions are unchanged: Propose Stuck,
Approve Stuck, Return to Queue, and the rail narrowing (`?mv=` / `mvc` / `mvb` still drive
`managerRail`; only the edit affordance keyed off `mv`). To correct Serving, Primary/Secondary
Insurance or a Member ID, the patient goes back through Profile Send-Off.

**Why** (Josh). Editing those five fields is only half a correction — a payer change has to be
re-verified through Stedi, and the Insurance board cannot run one. Findings from the live boards
and Railway, worth keeping so this isn't re-litigated:
- The Stedi trigger is a stock Monday webhooks recipe (**id 130**, subscription `562943120`):
  *"when `color_mm1yeksx` changes to index 1, POST to the webhook."* Insurance already runs two
  identical recipe-130 subscriptions for the DVS triggers, so the trigger half is easy — but the
  column doesn't exist on Insurance.
- **Neither eligibility input exists on Insurance**: General Insurance (`color_mm24ap4j`) and the
  working Member ID (`text_mm4t8gbq`). Name and DOB do (DOB shares `text_mm1xvxst` across both
  boards — they were duplicated from one template).
- **Insurance carries ~9 of 33 Stedi result columns**, arriving by hop-copy, and is missing both
  terminal signals (Eligibility Active?, Error Description) plus Coverage Type, Managed Medicaid,
  Medicare Advantage ×3, Medicaid ID, Secondary/Medicaid ID, In-Network?, Prior Auth Required?,
  Copay, the family deductible/OOP splits, Stedi Gender, Stedi Address and facility flags — ~22
  columns. Several are load-bearing (`isCoverageActive`, the Managed-Medicaid and MA/QMB banners,
  the serving + cross-sell suggestion, and `Plan Name` → MLTC detection at Submit Auth).
- The Railway **`stedi-monday-integration`** service is bound to one board's schema — a single
  `ELIG_COL_FIRST_NAME/LAST_NAME/DOB/INSURANCE/MEMBER_ID` set, and a board list of
  INTAKE/ONBOARDING/CLAIMS/ORDER with no Insurance board.

**Snowball effects: none observed.** `npm test` **53 files / 600 tests**, all green — exactly
−23, the deleted module's own tests; no other suite moved. `tsc --noEmit` clean; `npm run lint`
unchanged from before the removal (32 pre-existing errors, none in the touched files). Two
incidental fixes fell out: an orphaned doc comment in `mondayWrite.ts` now sits with
`saveNoAuthNeededToMonday`, and one in `mondayApi.ts` with `readColumnTexts` — both had drifted
onto the wrong function.

**Also corrects §10 quirk list:** quirk 12's neighbours are unaffected, but the baseline's §1.3
dead-code map and §7.3 manager-actions list should be read with this removal applied.

### 2026-08-02 · Escalation-routing fixes (Brandon's seven)

Seven reported items, all shipped together. Tests **600 → 616**; `tsc` clean; lint unchanged.

1. **Pump SoS Not Clear now escalates at Auth Outstanding too.** The Benefits path was already
   correct (verified by simulation). The gap was a pump whose SoS was DEFERRED at Benefits — rep
   answered Auth = Required ⇒ derived *Skip* — which reaches the not-clear finding for the first
   time at the Auth Outstanding recheck. That context had no pump rule, so the pump moved into Not
   Clear Products (putting the patient in Oversight's Pump SoS bar, which keys on the dropdown)
   while Escalation stayed blank. `mondayWrite` authOutstanding now writes Manager when the pump's
   *effective* SoS is not-clear. **Verified against a live board item** (created, exercised through
   the real read → `mondayItemToPatient` → decision path, deleted): `done` before, `manager` after.
2. **Per-product Auth answers now round-trip on Benefits.** `READ_COLUMN_IDS` contained none of the
   auth columns, so Benefits wrote Auth Required/Not Required and fetched it back from nobody —
   identical to the universal-checks bug of 2026-07-30. Added the five `authResult` columns to the
   base list and removed them from `AUTH_READ_COLUMN_IDS` (which spreads the base list — the
   `universalRoundTrip` duplicate test caught that immediately).
3. **"Send back to pipeline" in Manager Intervention** — `returnToQueue` was gated to Final
   Decisions. Note optional. (The half of this item about reps not seeing escalated patients was
   already true: default view filter `nonEscalated`, and `samActive` excludes escalated.)
4. **One negative universal check no longer requires the other two.** `validateBenefitsFactsForSubmit`
   ran the three-answer loop before the negative early-return.
5. **Propose Stuck is now ladder-aware** (`proposeStuckLevel`) — see CLAUDE.md §7. Could not
   reproduce the reported "went to Final from Submit Auth"; the code wrote Manager and the board
   had zero Final-escalated items at the time.
6. **Final Decisions charts reason-bucketed** for Submit Auth (3 bars) and Auth Outstanding (1 bar).
7. **DVS**: Propose Stuck added to the page (new `dvs` StageKey), both DVS bars escalation-split so
   a promoted patient leaves Janelle's chart, and a new Final→Manager transition
   (`returnInsuranceToManager` + `returnToManager` action, scoped to DVS × Final Decisions).

**Outstanding, needs a Monday admin:** board automation **7918444697** (Trigger Supplies DVS →
Failed / Manual Review / MLTC ⇒ Manager Escalation Required) is still **inactive** — the MCP
connection returned `USER_UNAUTHORIZED` on activate. It watches the SUPPLIES column only, so pump
DVS and claims failures would still need hand-escalation even once it's on.

### Board findings that are still open (not caused by any change here)

Found while scoping, unresolved, and relevant to any future "send it back to Benefits" work:
- **No automation moves an item back to the Benefits group.** Active Stage-Advancer→group moves
  are only `4→Submit Auth`, `6→Auth Outstanding`, `2→Stuck`, `0→Auth Denied`, `1→DVS`. Writing
  stage = Benefits/SoS (3) leaves the item in its current group, invisible to the group-read
  Benefits queue. (`7918291617`, Complete→Complete group, is **inactive**.)
- **Stage 3 bounces Medicaid patients straight to DVS.** Three active automations
  (`7921013564` / `7921013652` / `7921013691`) fire on stage→3 and, for NY-Medicaid-secondary or
  Medicaid-primary patients with certain Servings, immediately set stage := 1 (DVS) and force the
  supplies (± pump) auth results to Required.
- **A DVS group now exists** (`group_mm5gp2r2`) and stage→1 actively moves items into it
  (`7921018058`). The codebase still assumes "DVS has no group" — `useMondayPatients`,
  `useRoleCounts`, both baseline generators, CLAUDE.md §5.8. Nothing breaks today (those paths
  filter by stage), but the comments are stale.
