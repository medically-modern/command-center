# Benefits Redesign Review — Brandon's handoff vs. the live tab (2026-07-15)

**What this is:** a change-by-change comparison of Brandon's redesign
(`JOSH_HANDOFF_BENEFITS.md` + `benefits-redesign.html`, both now at repo root) against the
current Benefits implementation (`src/pages/ChaseBenefitsPage.tsx`, `src/lib/samantha/*`,
`src/components/samantha/*`), ranked most→least severe, with downstream effects traced.
Every load-bearing claim below was verified against source (file:line cited) and, where
marked **[live board]**, against the live Insurance board `18410601299` and its automations
via the Monday API on 2026-07-15.

**Not included in the handoff:** `ANTHEM_BCBS_PRIMARY_SUGGESTION_RULEBOOK.md` (referenced by
spec §7) was not attached. The §7 rules below are known only from the spec's own summary.

---

## TL;DR — the five things that bite

1. **The "TBD" write (spec §2) targets a column that does not exist on the Insurance board.**
   `text_mm58k9x9` is a *Welcome Call board* column, and the WC item doesn't exist yet at
   Benefits time — it's created later by the live "Stage Advancer → Complete → create item in
   Welcome Call" automation, whose ~90-column copy map has **no pump-date source**. Needs a new
   Insurance column + automation mapping + WC-side handling ("TBD" survives the WC form's
   auto-clear only inside its display gate).
2. **Last-Bill-Date presence currently *encodes* "Not Clear".** The facts model (date + units
   for every billed product) breaks Final Confirm's SoS display and changes what Welcome Call
   sees, unless the write rule or the downstream heuristic is changed in the same release.
3. **Removing Trigger DVS before the DVS stage exists strands Medicaid patients.** The DVS
   bots key on the trigger columns **[live board]**; nothing else fires them at Benefits.
4. **Derived escalation feeds a live automation that removes the patient from every app
   queue** (Escalation = "Escalation Required" → item moves to the Escalations group, which no
   app counter, sidebar, or systemMgmt group list reads) — and derived escalations carry **no
   reason text** for managers.
5. **The handoff doc's own baseline claim is wrong:** current code is *not* "flat 90 days for
   everything" — the 4-yr pump/monitor lookback already exists as UI guidance
   (`InsurancePanel.tsx:403-409`). The genuinely new pieces are the **Medicaid 60-day tier**
   and **derivation replacing rep choice**.

---

## Decisions — 2026-07-15 (Josh)

- **D1 (S1, TBD pump date):** DONE — new text column **`text_mm59qh8r`** "Medicare Prior Pump
  Date" created on the Insurance board 18410601299 (2026-07-15).
  **⚠️ ACTION FOR JOSH — still open:** add a copy mapping in the Stage Advancer → "Complete" →
  create-item-in-Welcome-Call automation (**automation id `7918324247`**) so
  `text_mm59qh8r` (Insurance) → `text_mm58k9x9` (Welcome Call). Until that mapping exists the
  TBD never reaches the Welcome Call rep. Text→text copy is safe for the literal "TBD".
- **D2 (S2, last-bill dates):** write the entered Last Bill Date for **every** billed product,
  and change **Final Confirm to read the actual SoS columns instead of inferring "Not Clear"
  from date presence** (`finalConfirm/mondayMapping.ts:107-111`). Implementation note: Final
  Confirm lives on the Welcome Call board and can only read what the create-item automation
  copies — the per-product SoS truth on the Insurance board is the **Not Clear Products**
  (`dropdown_mm2vez5a`) + **Skip SoS Products** (`dropdown_mm31163t`) dropdowns, which are
  **not currently in automation `7918324247`'s copy map**. Add both (dropdown→dropdown copy)
  when making the D1 automation edit, then point Final Confirm's parser at them.
- **D3 (S3, Trigger DVS):** remove the Benefits buttons; the DVS stage will own this later.
  Interim reality: Submit Auth / Auth Outstanding keep their buttons; straight-Medicaid
  supplies-only patients don't advance on their own, so they're handled manually on Monday
  until the DVS stage ships.
- **D4 (S7, escalation reason):** auto-compose the derived-escalation reason line and
  **append it to the Insurance notes column `long_text_mm2ffsme` (Call Reference Notes)** —
  visible to all three Insurance roles and hop-copied to Welcome Call — NOT to the
  escalation-notes column. Compose read+append once, inside the verified batch (same
  append-writer rules as the S6 call logs).
- **D5 (S4, labels):** verified against the live board 2026-07-15 — all labels/ids in the
  Skip→recheck path match (Skip/Not Clear dropdown ids 1–5, SoS 0:Skip/1:All Clear/2:Partial /
  Not Clear, Auth aggregate, all five Auth Result sets, universal checks, Escalation). The
  Medicaid-pump Clear→Skip change is **intended**. No board label work needed; keep writing by
  index.

---

## 1. Severity-ranked changes

### 🔴 S1 — CRITICAL: Never-billed "TBD" → `text_mm58k9x9` (spec §2)

**New:** Medicare A&B + Infusion Sets *and* Cartridges = Never Billed → write `Never billed
IS/Car = "Never Billed"` and the literal `"TBD"` to pump-date text column `text_mm58k9x9`.

**Problem — wrong board:** `text_mm58k9x9` is mapped only on the Welcome Call board
(`welcomeCall/mondayApi.ts:54`, `finalConfirm/mondayApi.ts:70`, both `BOARD_ID 18410804557`,
"Medicare Prior Pump Date"). `src/lib/samantha/*` has no pump-date column, and **[live board]**
the Insurance board has no text/date column with a pump-date meaning at all.

**Problem — no target item:** the pipeline hop is Insurance → Welcome Call. **[live board]**
Automation `7918324247` ("Stage Advancer changes to **Complete** → create item in board
**18410804557 Welcome Call**") creates the WC item *after* Benefits completes, copying ~90
columns — none of them a pump date. So at Benefits time there is nothing to write `TBD` onto.

**Problem — downstream wipe:** both Welcome Call and Final Confirm *always* write the field on
save (empty string clears the cell — `welcomeCall/mondayWrite.ts:82-86`,
`finalConfirm/mondayWrite.ts:233-239`) and auto-clear local state whenever the display gate is
false (`WelcomeCallForm.tsx:188-193`, `PatientInfoCard.tsx:547-551`). Gate =
`isOriginalMedicare(primary) && pumpQty !== "1"`. A `TBD` written upstream survives only for
Original-Medicare patients whose Pump Qty isn't set to "1"; flip Pump Qty to 1 (or change the
insurance) and the next WC/FC save erases it.

**To implement §2 you need:** (a) a new Insurance-board text column (e.g. "Medicare Prior Pump
Date"), written inside the verified batch; (b) an added mapping in automation `7918324247`
(text→text copy is safe for the literal `TBD`; never route a parseable date string through a
text hop — CLAUDE.md §9); (c) a WC/FC decision that `TBD` means "ask the patient", so the gate
and auto-clear don't erase it; (d) update `BOARD_SCHEMA.md` (already stale here — it predates
`text_mm58k9x9`).

Prototype nuance to confirm with Brandon: `deriveNeverBilled()` keys TBD **only** on Infusion
Sets + Cartridges both = Never Billed — the pump's own "No Billing History" entry is ignored
(a Medicare A&B patient with a *known* pump bill date still gets `TBD` if IS+Car are
never-billed).

### 🔴 S2 — CRITICAL: the facts model vs. "date presence = Not Clear" (spec §1)

**Old:** rep picks Clear / Not Clear / Skip per product; the Last Bill Date input exists only
when SoS = Not Clear (`InsurancePanel.tsx:534-551`); the per-product date columns
(`date_mm33h1qv/332rhq/33qnew/33gj86/33cd87`) are written **only** for not-clear products and
explicitly **cleared** otherwise (`mondayWrite.ts:237-257`).

**New:** rep records Last Bill Date + Units (or No Billing History) for *every* visible
product; Clear/Not Clear is derived. Spec §1 says units are written "alongside the last bill
date" — implying dates now flow for **all** billed products.

**What breaks if dates are written for derived-Clear products:**
- `finalConfirm/mondayMapping.ts:107-111` derives its per-product SoS display **purely from
  date presence** → every billed product shows "Not Clear" at Final Confirm.
- Welcome Call re-displays the copied dates (`welcomeCall PatientInfoCard.tsx:543-547`) and
  uses them in its next-order fallback chain (`welcomeCall/workflow.ts:364-370`).
- The current clear-on-clear behavior disappears (stale dates stop being wiped).

**Decision needed (one of):** keep the current write-only-when-not-clear rule (and the facts
live only in new columns / the overlay), **or** write all dates and fix
`finalConfirm`'s heuristic + WC displays in the same change. Don't ship the middle.

### 🔴 S3 — CRITICAL: Trigger DVS removal sequencing (spec §8)

**Old:** Benefits shows **Trigger Supplies DVS** / **Trigger Pump DVS** buttons
(`ChaseBenefitsPage.tsx:95-118,227-257`); on send they write `color_mm26pk1a` /
`color_mm578kbd` index 1, which the Railway `automate-dvs*` bots key on. **[live board]**
Confirmed: legacy automations `595975096`/`607839558` trigger on those columns at index 1, and
`7918551045` moves "Retry Queued" items to Auth Outstanding.

**New:** button removed from Benefits; "DVS moves to its own stage (separate handoff to
come)"; supplies-only / straight-Medicaid patients "skip Benefits entirely"; Medicaid-billed
supplies hidden with a banner.

**Risks:**
- **The DVS stage does not exist yet.** Until it ships, removing the Benefits buttons means
  nobody fires the supplies/pump bots at Benefits. SubmitAuth and AuthOutstanding retain their
  own buttons (`SubmitAuthPage.tsx:130-160`, `AuthOutstandingPage.tsx:134-160`) — partial
  mitigation only for patients who reach those stages.
- **Supplies-only Medicaid patients have no exit.** The prototype shows "No benefit check
  needed … they go straight to the DVS stage", but the patients are still sitting in the
  Benefits group and nothing moves them (the prototype still gates send on the 3 universal
  checks even for these patients). Interim SOP or DVS-stage-first sequencing required.
- Keep the hidden-supplies auto-fill: both today (`mondayWrite.ts:124-140`) and the prototype
  hardcode hidden Medicaid supplies to Auth=Required / SoS=Clear, and the code comments note
  the DVS automation expects those auth-result columns to flip blank→"Required" at Benefits
  send. This must survive the rewrite.

### 🟠 S4 — HIGH: SoS derivation + non-overridable Skip changes real board data (spec §1)

**Old:** rep-selected SoS; picking Auth=Required auto-sets Skip but the rep can override
(`InsurancePanel.tsx:468-476,498-518`). **Medicaid + Insulin Pump pre-fills Auth=Required +
SoS=Clear** (`InsurancePanel.tsx:93-102`) → today a Medicaid pump lands **"Clear"**, is *not*
in Skip SoS Products, and never enters the Auth Outstanding recheck.

**New:** `Auth=Required → SoS=Skip`, unconditionally, UI disabled (prototype
`derivedSos()`, `benefits-redesign.html:738-740`). No Medicaid-pump pre-fill exists in the
prototype. Consequences:

- Every Medicaid pump now lands in **Skip SoS Products** (`dropdown_mm31163t`) and becomes
  eligible for the **sosRecheck** flow at Auth Outstanding (`AuthOutstandingPanel.tsx:323`
  — surfaces when `sos === "skip" && authOutstandingResult === "no-auth-needed"`). Probably
  the *intent* (defer SoS until auth resolves) — but it changes board data and adds a recheck
  step for a whole patient class. Confirm with Brandon.
- Derived Skip must keep the exact option ids/labels (ids 1–5, `mondayMapping.ts:76-86`) or
  skipped products silently stop hydrating for recheck — the dropdown is rewritten wholesale
  every send, not merged (`mondayWrite.ts:207-235`).
- **Boundary:** prototype derives Clear only when lastBill is *strictly* older than the cutoff
  (`<` on ISO strings) — a bill exactly on the cutoff date is Not Clear. Confirm intended.
- **Lookbacks:** the doc's "current live code uses flat 90 days" is **wrong** — pump/monitor
  4-yr already exists (`InsurancePanel.tsx:403-409`, guidance text only). Actual changes:
  (a) the **Medicaid 60-day tier** for sensors/supplies (`patientHasMedicaid()` = substring
  match on either insurance — same convention as today's next-order math), (b) the lookback
  now *computes* SoS instead of advising the rep.
- **Good news (verified):** every derived output in the prototype's drawer uses today's exact
  labels and priority — `All Clear`/`Partial / Not Clear`/`Skip` (priority not-clear > skip >
  clear), `Auths Required`/`No Auths Required`, per-product `Required`/`No Auth
  Needed`/`Not Serving`, `Never Billed` — so the backend should reuse `UNIVERSAL_INDEX`,
  `AUTH_RESULT_INDEX`, `NOT_CLEAR_PRODUCT_ID`/`SKIP_SOS_PRODUCT_ID` and write **by index**,
  not label. **[live board]** Stage Advancer label id 4 is **"Submit Auth."** — the
  prototype's "Authorization" is a display name only; keep `STAGE_INDEX` index writes.

### 🟠 S5 — HIGH: read-only header removes the last data-repair point (spec §6)

**Old:** at Benefits the rep can edit Primary Insurance, Member IDs, DOB, phone, address,
doctor fields (pencil toggle) and **Secondary Insurance + Member ID 2 + Carecentrix ID are
always editable** (`PatientProfileCard.tsx:269-383`); edits are written to Monday on send
(`mondayWrite.ts:694-827`).

**New:** everything read-only; Profile Send-Off must finalize all of it (incl. secondary
insurance and Medicaid ID) before the patient reaches Benefits.

**Risks:**
- `sendPatientToMonday` **throws** when Serving/Primary are missing or resolve to no products
  (`mondayWrite.ts:74-80`). With no edit path, a patient arriving with bad header data is
  hard-stuck at Benefits with no in-page fix and no send-back-to-Profile mechanism (none
  exists on this board). Needs a "return to Profile" path or a Profile-side completeness gate.
- Secondary Insurance currently drives the derivations the redesign *adds*: Medicaid supply
  routing (`suppliesRouteToMedicaid` needs secondary exactly `"NY Medicaid"`,
  `hcpcRules.ts:157-166`), the new 60-day lookback, and DVS/Medicaid UI gates. Upstream
  Profile data quality becomes load-bearing; note Profile stores secondary in a *different*
  column (`color_mm1zbrx0`) that hop-copies to the Insurance board's `color_mm241kqp`.
- **Missing columns for the new header [live board]:** the Insurance board has Stedi QMB
  (`text_mm2wabwr`), Coinsurance % (`text_mm39k0hz`), Plan Begin (`text_mm3ggbwa` +
  `date_mm4wwm2b`), Plan Name (`dropdown_mm2w11t4`), deductible/OOP columns — but **no Home
  Plan, no Coverage Type, no Medicaid ID** columns. The payer-aware header (§6) and the BCBS
  who-to-call pills (§7) need those values delivered to this board (new columns + Stedi/
  Profile hop) or fetched cross-board. And §7 is explicit: home-plan identity must come from
  the 271 (`_parse_home_plan` canonical names) — the prototype's first-word string match
  (`callPlans()`) is a demo shortcut that must **not** ship.

### 🟠 S6 — HIGH: two append-only call logs vs. an overwrite-shared notes column (spec §4)

**Old:** one shared **Call Reference Notes** column `long_text_mm2ffsme` across all three
Insurance roles. Every save is a **full overwrite** — NotesPanel's "append" is client-side
only (`NotesPanel.tsx:20-48` + inline `writeLongText` on 3 pages; batch send rewrites it
again from overlay state, `mondayWrite.ts:829-836`). Last-writer-wins.

**New:** two call-log sections (rows of Ref # + notes) **appended** on send, one line per
call, section-2 rows tagged as SoS/auth calls; "rows are append-only history; don't overwrite
prior sends". The prototype never serializes them — the format exists only in the doc.

**Implementation hazards:**
- Append onto an overwrite-shared column means read-merge-compose **once** before task
  creation (the repo's established retry-safe pattern — RELIABILITY_AUDIT §H) inside the
  verified batch; but concurrent inline overwrites from SubmitAuth/AuthOutstanding (and the
  Benefits freeform notes save — the prototype *keeps* the Reference Notes textarea) can still
  clobber appended history. Decide: separate column(s) for call logs, or make the notes column
  genuinely append-only with a single composed writer per send.
- The same column id is `COL.notes` on the Welcome Call board and is in the WC-item create
  automation's copy map **[live board]** — unbounded appends travel to every later board and
  balloon what managers see in systemMgmt/oversight drill-downs.

### 🟠 S7 — HIGH: derived escalation + Escalate/Follow-Up button removal (spec §5, §8)

**What stays the same (verified):** the send already always writes Escalation
(`color_mm2vsh2f`) as "Escalation Required" (blocker = any universal not-confirmed OR pump
SoS not-clear) or "Done" (`mondayWrite.ts:327-419`), and the escalation/advancement rules in
spec §5 are the **same rules** — so the write side barely changes. The exact string
"Escalation Required" (label id 0 **[live board]**) is matched in ≥6 systems
(`useRoleCounts.ts:56,64,283-287`; `systemMgmt/mondayApi.ts:303-305` — also "Escalate";
`samantha/mondayMapping.ts:319-320`; `snapshot-baseline.mjs:76,146-151`;
`baseline-cron/index.mjs:75,143-144`) — reuse `ESCALATION_INDEX`, write by index.

**What changes:**
- **[live board]** Automation `7918291647`: Escalation → "Escalation Required" (if Stage
  Advancer ≠ Auth Denied) **moves the item to the Escalations group `group_mm2vg9gn`** — a
  group that *no* app surface reads: not the role fetches (`samantha/mondayApi.ts:9-14`), not
  `useRoleCounts`, not the baseline generators (Insurance escalation groups =
  benefits/submitAuth/authOutstanding/authDenied, `snapshot-baseline.mjs:81`), not
  systemMgmt's `activeGroups` (`systemMgmt/mondayApi.ts:147-162`). Only the oversight charts
  (which filter by Stage Advancer *text*, board-wide) still see them. Today that fate requires
  a rep decision (Escalate button / choosing to send a blocker). Under full derivation, **any
  submit with a failed check or pump-not-clear silently ejects the patient from every app
  queue into a Monday-only group** — likely the intended manager-triage flow, but say it out
  loud, and confirm the un-escalate path (the patient can't be re-sent from the Benefits page
  because they're no longer in its group; the escalated deep-links/`?patientId=` path still
  works).
- **No reason text:** the EscalationFormModal (Rep name / Issue / Tried / Ask / Urgency →
  `long_text_mm3jrssp`) goes away at Benefits; derived escalations write no notes (true today
  for auto-blockers too; SubmitAuth/AO keep their modals — `SubmitAuthPage.tsx:288`,
  `AuthOutstandingPage.tsx:376`). Managers will see more escalations with empty reasons.
  **Suggestion:** auto-compose a reason line from the failing derivation (e.g. "Auto-escalated:
  DME Benefits = Not Covered; IP last billed 2024-11-02, within 4-yr window") into the notes/
  escalation-notes column inside the same verified batch.
- **Follow Up removal:** removing the button only stops *new* follow-ups at Benefits;
  patients already parked stay excluded from counts until cleared (keep the sidebar
  Remove — `PatientsSidebar.tsx:43-75`). The `followUp !== "Follow Up"` exclusion **must stay**
  in `useRoleCounts` + both baseline generators (three-file counting contract, CLAUDE.md
  §5.8) because SubmitAuth/AO still set it. Reps lose their only "park this patient" tool at
  Benefits — SOP question, not a code question.
- **Positive:** deleting the Benefits modal removes audit findings M2 / B4 (wrong-patient
  escalation writes) and B13's inline Follow-Up writes for this page — provided the derived
  escalation stays inside the verified batch (it already is).

### 🟡 S8 — MEDIUM-HIGH: Never Billed derivation inherits the can't-unset gap (spec §2)

Same columns, same labels, same Medicare A&B-only gate as today (`color_mm3zjyya`,
`color_mm3zg2pn`, index 0 "Never Billed"; UI gate `primaryInsurance === "Medicare A&B"` —
exact string, other Medicare plans don't qualify, in both worlds). But audit **B5** still
applies: the columns are written only when truthy and never cleared (`mondayWrite.ts:421-435`).
Under *derivation* the gap gets worse — if a later send's entries imply "not never-billed",
the stale "Never Billed" persists forever unless the rewrite adds a clear write. If it does:
clear by writing **empty**, not a "No" label — the WC mirror columns
(`color_mm3zn2qy`/`color_mm3z8rw0`, copied by the WC-create automation **[live board]**)
parse *any* non-empty text as true (`welcomeCall/mondayMapping.ts:123-124`), and they drive
the WC "Never billed" banners.

### 🟡 S9 — MEDIUM: Units are genuinely net-new board schema (spec §1)

No per-product SoS-units columns exist anywhere. The Welcome Call board's
`numeric_mm2w5jdp/gfrb/ayp9/h4ph/cgkc` are **Auth Units** (a different concept, written from
SubmitAuth). The prototype collects per-product units and gates completeness on them but its
drawer never previews a Units write — the only spec is the doc's one line ("add a Units column
to the Welcome Call board", singular). Needed: decide granularity (per product? sensors/
supplies only?), add Insurance-board column(s) written in the verified batch, extend the WC
create-automation copy map **[live board]**, add to `welcomeCall`/`finalConfirm` mappings and
`BOARD_SCHEMA.md`.

### 🟡 S10 — MEDIUM: "Gating (client + server)" — the server half doesn't exist (spec §5)

The gateway is deliberately dumb: `/gql` forwards verbatim; `POST /send` validates structure
only; auth is non-blocking by design (RELIABILITY_AUDIT D2). And the samantha send never uses
`/send` anyway — its tasks carry no raw `value`, so it always runs the client path
(`verifiedWrite.ts:154`). Server-side gating of the Benefits submit therefore means: new
payload-aware validation in `send.mjs` (most sanely scoped to flips of `color_mm1ws96t` on
board 18410601299) **plus** migrating the Benefits send to the `/send` fast path (raw values +
expectedText — which would also fix tab-close durability, a real win), **plus** accepting that
`/gql` and direct mode can bypass it. Scope decision for Josh — v1 could reasonably stay
client-only with the server mirror as a follow-up.

### 🟡 S11 — MEDIUM: relabeled universal checks + the read-back gap (spec §3)

Relabels only — same two columns, same labels/indices (`Active/In-network`/`Stuck` on
`color_mm2vhwan`; `Yes`/`Partial / No` on `color_mm2vt8xg`), In-Network + Active still
collapse into one column. Keep today's "write nothing when unanswered" (the prototype drawer
previews `Stuck` for unanswered checks, but gating blocks send until all are answered, so
at-send behavior is identical). Related existing gap that now matters more: the **Benefits
group fetch never reads back** the universal/aggregate columns (`AUTH_READ_COLUMN_IDS` only
applies to auth groups — `samantha/mondayApi.ts:202-213,319`), so checks hydrate blank on
reload; the facts model stores even *more* rep work in the local overlay (dates, units,
never-billed entries have no Benefits-readable columns unless S2/S9 add them). Consider adding
the columns to the Benefits read set or accept that a reload mid-patient loses the entry work.

### 🟢 S12 — LOW: intentional removals, cosmetics, and prototype artifacts not to ship

- **Removed on purpose (spec §8), no downstream readers:** product billing-note text,
  universal-check hints, rep-facing Clear/Not-Clear language, "edits stay local" strip (its
  "refreshes every 60 seconds" copy is wrong anyway — the poll is 30s,
  `useMondayPatients.ts:41`), Follow Up + Escalate buttons (see S7), Trigger DVS (see S3).
- **Monday Board Output drawer:** keep during implementation as the write-verification
  oracle, delete for prod — note the current `InsurancePanel` has its own equivalent preview
  (`MondayOutput`, `InsurancePanel.tsx:589-884`); decide whether prod keeps that one, since
  the prototype ships none.
- **Prototype artifacts that must NOT be ported** (all verified in the HTML's JS):
  first-word home-plan string match (`callPlans()` — §7 demands `_parse_home_plan` canonical
  names); `PAYER_PHONES` starter directory (dead code; the doc says the phone directory is
  future/Monday-board); drawer Next-Order rows computed from `lastBill` even while
  Auth=Required (contradicts the doc's "entered date/units are ignored while Auth = Required" —
  the backend should follow the doc); Step-2 subtitle still says "select … Same or Similar
  status" (contradicts §8's no-Clear/Not-Clear-language rule).
- **Internal inconsistency to confirm, not a bug:** sensors' SoS lookback tightens to 60d
  under Medicaid but sensors' Next Order Date stays +90d flat (doc and prototype agree; the
  Medicaid 60d next-order applies only to supplies).
- **Rewrite housekeeping while in the file:** the per-product auth-submission field block is
  queued **twice** per send (`mondayWrite.ts:458-519` and `619-692`); `PillarsChecklist.tsx`
  and `PathwayPanel.tsx` are dead code; preserve the sidebar machinery
  (`sidebarList.ts` + tests, auto-select, `?patientId=` deep links, overlay deep-merge) and the
  shared-context `sendPatientToMonday` — **Benefits-only derivation changes inside it must be
  context-gated** or they alter SubmitAuth/AuthOutstanding sends too.

---

## 2. Downstream-effects map (by artifact)

| Artifact (Insurance board unless noted) | Consumers | Redesign impact |
|---|---|---|
| `text_mm58k9x9` pump date (**WC board**) | WC + FC forms (always-write + gated auto-clear) | S1: new Insurance column + hop mapping + gate/SOP change required |
| Last Bill Dates `date_mm33*` (+ WC copies `date_mm33vqa0…`) | samantha write/read; **finalConfirm derives SoS from presence**; WC displays + next-order fallback | S2: decide write-all vs write-not-clear-only; fix consumers together |
| Next Order Dates `date_mm35*` (+ WC copies) | WC/FC re-display, re-derive, rewrite; FC advance eligibility | Math unchanged; don't port the drawer's ignore-auth bug; WC's own `computeNextOrder` fallback (blank → today) stays divergent |
| `dropdown_mm31163t` Skip SoS Products | Hydrates `sos="skip"` (exact labels) on all 3 role pages; AO sosRecheck; rewritten wholesale each send | Same ids/labels mandatory; Medicaid pumps newly enter it (S4) |
| `dropdown_mm2vez5a` Not Clear Products, `color_mm2vemyy` SoS, `color_mm2vg3ew` Auth | Oversight drill-down pills; board views; same-label round-trips | Same labels/indices mandatory (prototype already matches) |
| `color_mm2vsh2f` Escalation ("Escalation Required"/"Done") | `useRoleCounts`, `useEscalatedCounts`/systemMgmt, `mondayMapping` sidebar flag, both baseline generators, roleView filters; **[live]** automation → Escalations group | S7: keep index writes; group ejection now fully automatic; add auto-composed reason text |
| `long_text_mm3jrssp` Escalation Notes | systemMgmt display; SubmitAuth/AO modals still write it | Benefits writer disappears (S7) |
| `color_mm1ws96t` Stage Advancer | verifiedWrite stage gate; **[live]** group moves (Submit Auth / Auth Outstanding / Complete/Stuck / Auth Denied) + **create WC item on "Complete"**; oversight text filters; systemMgmt route maps | Keep `STAGE_INDEX`; board label for index 4 is **"Submit Auth."** |
| `color_mm26pk1a` / `color_mm578kbd` Trigger DVS | Railway automate-dvs\*; **[live]** legacy automations on index 1; AO status displays + completion gate | S3: sequencing with DVS stage |
| `color_mm3zjyya`/`color_mm3zg2pn` Never billed (+ WC mirrors `color_mm3zn2qy`/`mm3z8rw0`) | 3 role pages round-trip; WC banners (any non-empty text = true); WC-create copy map | S8: keep label; clearing must write empty |
| `long_text_mm2ffsme` Call Reference Notes (same id = WC `COL.notes`) | 3 role pages overwrite inline + on send; systemMgmt/oversight display; WC-create copy map | S6: append semantics + column decision |
| `color_mm34jz1x`/`date_mm34m2dz` Follow Up | sidebar sections, counts exclusion (3-file contract), SubmitAuth/AO buttons | Keep filters; button removal is Benefits-only |
| Header columns (serving/primary/secondary/member IDs/doctor) | send guard throws on missing serving/primary; Profile owns upstream (different secondary column id, hop-copied) | S5: repair path needed; Home Plan / Coverage Type / Medicaid ID columns don't exist yet |

## 3. What the redesign fixes (keep these wins)

- Benefits' three unverified inline write paths (Escalate modal, Follow Up modal, notes-only
  saves) collapse into the verified batch → resolves audit **M2/B4** (wrong-patient
  escalation) and **B13** at this page.
- Derivation removes rep mislabeling of SoS and the silent auto-skip-override trap.
- Read-only header ends the Benefits↔Profile write race on demographic columns.
- Facts (dates/units/never-billed) are better data than a bare Clear/Not Clear — *if* S2/S9
  give them columns to live in.

## 4. Open questions for Brandon / decisions for Josh

1. ~~**S2:** where do last-bill dates for derived-**Clear** products land?~~ **RESOLVED (D2):
   write everything; fix Final Confirm to read the real SoS columns.**
2. **S4:** ~~Medicaid pump Skip vs Clear~~ **RESOLVED (D5): intended.** Still open: is
   bill-date exactly on the cutoff = Not Clear intended? (minor)
3. ~~**S3:** keep the Benefits Trigger DVS button until the DVS stage ships?~~ **RESOLVED
   (D3): remove it; interim handling is manual.**
4. ~~**S1:** confirm the TBD design = new Insurance column + hop mapping.~~ **RESOLVED (D1):
   column `text_mm59qh8r` created; automation mapping still to do (Josh).** WC's Pump Qty = 1
   auto-clear accepted as-is.
5. **S6:** call logs into `long_text_mm2ffsme` (shared with freeform notes) or new
   column(s)? Retention/size policy for manager views and board hops? (D4 already makes the
   escalation reason line an appender into this column.)
6. **S9:** Units — one column or per-product, and which products?
7. **S7:** ~~auto-compose a derived-escalation reason into notes?~~ **RESOLVED (D4): yes —
   append to `long_text_mm2ffsme`.** Still open: the un-escalate / return-from-
   Escalations-group SOP.
8. **S10:** server-side gating scope for v1 (none / advancer-flip validation / full mirror +
   move the send to gateway `/send`)?
9. **S8:** should a later send be able to *clear* Never Billed, and TBD ignoring the pump's
   own entry — intended?
10. §7 depends on `ANTHEM_BCBS_PRIMARY_SUGGESTION_RULEBOOK.md` — not attached; needed before
    implementing the pills/POS warning.

## 5. Suggested implementation order

1. **Schema first** (S1, S9, S5-header): new Insurance columns (pump date, units, home plan /
   coverage type / Medicaid ID if header needs them), add to WC-create automation copy map,
   update `BOARD_SCHEMA.md` + `monday-integration-spec.md`.
2. **Derivation layer** in `workflow.ts` (pure functions + tests mirroring the prototype's
   `derivedSos`/`deriveNeverBilled`/`deriveMondayColumns`, with the doc's corrections from
   §1 discrepancies) — keep `sendPatientToMonday` writing by existing indices; context-gate
   everything to `"benefits"`.
3. **UI rebuild** of `InsurancePanel`/page per prototype (facts entry, call logs, read-only
   header, pills) with DEMO affordances stripped.
4. **Downstream fixes in the same release:** finalConfirm SoS heuristic (S2), WC TBD gate
   (S1), escalation reason auto-compose (S7).
5. **Sequencing gates:** don't remove Trigger DVS until the DVS stage handoff lands (S3);
   Profile completeness gate before the header goes read-only (S5).
