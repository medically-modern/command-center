# Patient Intake — backend implementation handoff (for Josh)

> **Status: LIVING DOC.** Built alongside the prototype as decisions land. Anything marked
> 🟡 **OPEN** is not decided yet — don't build it. Anything marked ✅ **DECIDED** is final
> unless this doc changes.
>
> Reference UI: **`patient-intake-redesign.html`** (standalone, self-contained — open in any
> browser). It is the Command Center `/profile` design system rearranged into the two-pane
> intake flow. The in-page "Build notes" panel at the bottom lists every deviation.

Last updated: 2026-08-05

---

## ⚠️ READ THIS FIRST — the little tags in the mockup are notes to you, not UI

Under **every field** in `patient-intake-redesign.html` there is a small stamp like:

> `FROM FORM  →  color_mm1w7pmf`  ·  `REP · ON CALL  →  NEW COLUMN NEEDED`  ·  `DERIVED  →  color_mm1w1978`

**These are build notes. They are NOT part of the design and must NOT appear in production.**
They are printed onto the mockup so you can see, for every single field, where the value comes
from and which Monday column it writes to — without cross-referencing this doc. When you build
the real page, **delete all of them.** Nothing about them is user-facing.

The same goes for the purple banner at the top of the mockup and the "Build notes" panel at the
bottom of the page — documentation only.

Full key in **§5.1**.

---

## 1. Scope

This is **Phase 1, item 5** of the Patient Intake Optimization project: the rep UI for the
**Patient Intake stage**, covering **DTC and CareCentrix referrals only**.

✅ **DECIDED — build this variant first.** Doctor / manufacturer referrals get a *separate but
very similar* UI later; do not try to make one page serve both. Adapt after this one ships.

### Boards
| Board | ID | Role here |
|---|---|---|
| DTC Intake | `18392794310` | top of funnel, form submissions land here |
| Profile Send Off | `18406352652` | the stage this UI works, group **1. Intake** `group_mm1xf2jb` |
| MM Doctor Database | `18142847597` | provider search + add |

DTC + CareCentrix is exactly the existing **Unverified Referrals** role
(`src/lib/profile/referralSplit.ts`: Referral Type = `Patient` **OR** Referral Source =
`CareCentrix`). Everything else stays on the current `/profile` Verified Referrals page.

🟡 **OPEN:** one Monday item or two (DTC Intake → Profile Send Off are separate items today,
joined by the `Move to Intake Board` automation).

---

## 2. The two-pane model

One screen, two panes:

- **Left — Patient Info. Collection.** Everything the patient gave us (form or referral email),
  rep-editable. Ends in a three-way decision.
- **Right — Patient Profile Clean-Up.** Locked and blurred until the unlock condition is met.
  Holds the verified/derived values that carry forward to Medical Necessity.

### ✅ DECIDED — the unlock rule (ALL FOUR must be true)

**Advance to Profile Clean-Up is disabled until every one of these passes.** It is *not* unlocked
by a button click, and *not* unlocked just because the form was complete.

| # | Condition |
|---|---|
| 1 | **Patient chose "Send request now" on the form**, **OR** the rep has ticked **Intake Call Complete** |
| 2 | The **Stedi check ran and did NOT fail** — a failed/errored check can never advance |
| 3 | Coverage is **Active** |
| 4 | The plan is **In-Network** |

The prototype renders these as a live four-row checklist inside the Advance card, so the rep can
see exactly what is blocking them. Build it the same way — a disabled button with no explanation
is the thing reps escalate about.

- Condition 1 exists because a patient who asked for a call has *not* authorized us to send the
  request yet. The rep completes that call and ticks the box. See §7.2.
- **In-Network** may be determined from the payer list for now. A more sophisticated network check
  comes later — build it behind a single function so it can be swapped.
  ⚠️ The *source* of the In-Network answer depends on §3, which is not settled — keep the unlock
  check reading from one helper so it can be repointed without touching the pane logic.
- On **Inactive**, **Out-of-Network** or a **failed check**, the pane stays locked and the rep
  works the left side (call the patient, correct the insurance, re-run). Each of the three shows a
  different banner with its own "what to do" — a failed check is a data problem (name/DOB/Member
  ID mismatch), Inactive is a coverage problem, Out-of-Network is an escalation.

### The happy path
✅ **DECIDED.** For a patient whose form is complete and who chose *"send my request now"*
(no call requested): the rep reviews the left pane, runs the benefits check, and advances.
That is the whole interaction — the left pane should be a confirmation, not data entry.

### Left-pane exits
1. **Advance to Profile Clean-Up** — gated on the unlock rule above.
2. **Insufficient — log call attempt** — increments the attempt counter, appends to the note log.
3. **Escalate — doesn't qualify** — reason + free-text context, routed for supervisor review.
   🟡 **OPEN:** destination column / group and who reviews.

---

## 3. Benefits check

> ## ⛔ JOSH — DO NOT BUILD THIS SECTION YET
>
> **The Benefits Check Output section is a placeholder and it is going to change.**
> Corey is doing plan-level research and we will rework this once his feedback comes back.
>
> - **Do not write any backend for it.** No new columns, no new writes, no changes to the
>   Stedi service, no changes to what the SPA reads back.
> - **Leave the existing Stedi plumbing exactly as it is.** It works — don't touch it.
> - Use the current UI **as a visual placeholder only** so the rest of the page can be built
>   around it. Assume the fields, the layout and the logic will all be replaced.
> - Everything else in this doc is real. This section is the one part that isn't settled.
>
> Build the rest of the page; come back to this when we hand you the revised spec.

### 🟡 PLACEHOLDER — current intent (subject to change)
The output is currently scoped down to **three fields**:

| Field | Values |
|---|---|
| **Network status** | In-Network / Out-of-Network |
| **Active status** | Active / Inactive |
| **Primary payor** | text |

Everything else is deferred — the full Stedi eligibility grid, cost sharing, and the
out-of-pocket estimate (Today's / 3-month / 6-month orders) are **not in scope right now**.

> **Do not remove Stedi columns or narrow the read set.** The underlying Stedi run is unchanged
> and the service still writes all the `stedi*` columns to Monday — we are simply not *rendering*
> them yet. They will very likely come back. Deleting columns or trimming `READ_COLUMN_IDS`
> because the UI stopped showing a field would be painful to undo.

### ✅ DECIDED — where it runs
The benefits check runs from the **left** pane, off **General Insurance** + **Member ID**.

**Sequencing is non-negotiable** (this is existing behavior, don't change it):
1. `writePatientProfile` — write Name / DOB / General Insurance / working Member ID to Monday.
2. `verifyProfileWritten` (≤3 tries). **If verify fails, abort — Stedi must not fire.**
3. Flip `Run Stedi Eligibility` `color_mm1yeksx`.
4. The `stedi-monday-integration` Railway service writes results back **one column at a time,
   ~1/sec over 15–25s. There is no "done" column.**
5. Poll every 4s, fingerprint the result columns, reveal only after the set has been stable
   ~10s (`STEDI_SETTLE_MS`). Byte-identical re-runs reveal after 35s; hard timeout 90s.

There is no synchronous result — the UI must show a running state.

### ✅ DECIDED — cross-sell is automatic
CGM cross-sell is derived, not asked. The rep never sets it manually; it surfaces as an
advisory chip only. Existing rules in `canCrossSellCgm` stand (Medicaid / Anthem JLJ /
United / Cigna are all blocked).

---

## 4. Insurance fields — which column is which

This is the part Corey's mockup collapsed, and it's the one thing that will silently break
if it's built wrong.

| UI field | Pane | Monday column | Who sets it |
|---|---|---|---|
| **General Insurance** | Left | `color_mm24ap4j` | rep / patient — what they told us |
| **Member ID** | Left | `text_mm4t8gbq` | rep / patient — **this is the ID Stedi reads** |
| **Secondary Insurance (as provided)** | Left | 🟡 new column — see §4.1 | patient, from the form |
| **Primary Insurance** | Right | `color_mm1xg10n` | **pre-populated** by the suggestion engine |
| **Member ID 1** | Right | `text_mm1x2qk2` | **pre-populated**, editable |
| **Secondary Insurance** | Right | `color_mm1zbrx0` | **pre-populated**, editable |
| **Member ID 2** | Right | `text_mm1xaccx` | **pre-populated**, editable |
| **Serving** | Right | `color_mm1w1cm9` | **pre-populated** from the derivation, editable |

### ✅ DECIDED — the right pane PRE-FILLS, it does not "suggest"

All five right-pane values — **Primary Insurance, Member ID 1, Secondary Insurance, Member ID 2
and Serving** — arrive **already entered in the dropdowns/inputs**, derived from what was
captured on the left. They stay **fully editable**; the rep changes one only when it's wrong.

This is a real change from the current page. Today the rep gets an **empty** dropdown with a
suggestion chip next to it and has to click the chip to apply it. **Remove all of that furniture**
— the suggestion chip, the confidence label, the state pin, the runner-up alternates. The value
goes straight into the field.

### ✅ DECIDED — hover explains WHY (nice-to-have, but specced)

Next to **Primary Insurance** and **Serving**, an ⓘ icon reveals a hover card explaining how the
engine reached that answer. The reasoning already exists in
`src/lib/profile/primaryInsurance.ts` — it returns `reason`, `confidence`, `alternates`, `pos`
and a `warnings[]` array. Today some of that is rendered as chips; instead, compose it into the
hover.

The hover should cover, in plain language:

- what the check actually returned (payer name, coverage type, plan name)
- which rule fired (e.g. managed-Medicaid plan name → Medicaid variant, not Commercial)
- home-state routing, and any POS / out-of-state / home-plan-mismatch warning
- confidence, and the runner-up options it considered

For **Serving**, the same treatment over the cross-sell derivation: request type, whether managed
Medicaid was detected, and why CGM cross-sell was or wasn't added (`crossSellReason`
already produces these strings).

⚠️ **Warnings must not be buried in the hover.** Hard blocks and MSP/MA/facility banners stay as
visible banners — the hover is for explaining a *normal* pick, not for hiding a problem.

Member ID 2 remains **required when Secondary = NY Medicaid** — blocks advance.

### 4.1 ✅ DECIDED — secondary insurance is TWO different lists

- **Left pane = the form's answer, as a DROPDOWN of payer names** — the same list the form uses
  for primary insurance: `Anthem or Blue Cross Blue Shield` · `UnitedHealthcare` · `Aetna` ·
  `Cigna` · `Humana` · `NYS Medicaid` · `Medicare` · `Fidelis` · `NYSHIP Empire` · `Other` ·
  `None`. This is what the patient told us their secondary carrier is.
- **Right pane = the condensed Monday label set**, and that is what carries forward to Medical
  Necessity: `NY Medicaid` (0) · `Medicare Supplement` (1) · `None` (3). **No "Other" label
  exists** — don't add one to the right pane.

The left value is the raw claim; the right value is the decision. **Both need to persist** — the
left one needs a new column.

⚠️ **Form change needed:** the 8.4 form currently collects secondary insurance as **free text**.
It must become the **same payer dropdown** so the left pane has a bounded list to map from.

---

## 5. Label mapping — form ⇄ Monday

✅ **DECIDED — rule:** for every field we declare a single source of truth. Patient-facing form
copy may stay friendly; **the rep UI must render Monday board labels verbatim.** Monday
silently drops status writes for labels that don't exist, so a mismatch = data loss with no error.

Examples of where the source differs:
- *Reason for inquiry* → pulls from the **form**
- *Sensor / CGM type* → pulls from the **Monday board**

### 5.2 ✅ DECIDED — dropdowns read their options from Monday, minus a hide-list

> ⚠️ **SUPERSEDED IN PART, 2026-08-20 (Josh): there is no hide-list any more.** Everything below
> about reading options from the board at runtime still stands and is built. The one reversed
> decision is *"`Not Serving` is never offered to the rep"* — hiding it meant a rep could READ that
> value on a patient and never set it, or correct one the cross-sell derivation had written. Every
> picker now offers the column's whole label set, on both intake panes and on Referral Intake /
> Already In System. `HIDDEN_LABELS` is gone from `lib/profile/selectOptions.ts` and
> `lib/profile/boardLabels.ts`, and `ProfilePage`'s `noNotServing` with it. What survives is the
> rule underneath it: a current value that is not in the option list is still displayed (pinned,
> disabled), because a `<select>` matching no option renders blank and the next save wipes it.


**Yes, this is doable and it's the way to build it.** For **CGM Type**, **Pump Type**,
**CGM Coverage Path** and **Insulin Pump Coverage Path**, the options should come from the
board's own column settings at runtime — so adding or renaming a status on Monday flows straight
through to the UI — while **"Not Serving" is never offered to the rep.**

Half of this already exists. `ProfilePage.tsx` line 59 has:

```ts
const noNotServing = (labels: string[]) => labels.filter((l) => l !== "Not Serving");
const CGM_TYPE_OPTS = noNotServing(Object.keys(CGM_TYPE_INDEX));
```

The filter is right; the **source** is wrong — `CGM_TYPE_INDEX` is a hardcoded map in
`mondayMapping.ts`, so a new board label never appears until someone edits the code.

**Build it like this:**

1. **Fetch the settings once per session** and cache them:
   ```graphql
   boards(ids: [18406352652]) { columns { id title settings_str } }
   ```
   `settings_str` parses to `{ labels: { "0": "iLet", ... }, labels_positions_v2: { "0": 0, ... } }`
   — `labels` is index → label, `labels_positions_v2` is index → display order.
2. **Build a live label ↔ index map** from that, replacing the hardcoded `*_INDEX` objects for
   these four columns.
3. **Render the dropdown** from the live labels, sorted by `labels_positions_v2`, filtered by a
   single `HIDDEN_LABELS = ["Not Serving"]` list. **Also drop empty label slots** — several boards
   have blank ones that would otherwise render as empty options.
4. **Write by INDEX, not by label.** With labels now coming from the board, a rename on Monday
   would break a label-based write. Index is stable across renames; label is not.
5. **Keep the hardcoded maps as a fallback** if the settings fetch fails, so the page never
   renders an empty dropdown.

**Three things that must NOT change:**

- ⚠️ **"Not Serving" stays a real, writable value.** It is only hidden from the *picker*. The
  cross-sell derivation still writes it (`ProfilePage.tsx` ~line 827:
  `cgmType: "Not Serving", cgmCoveragePath: "Not Serving"`). Never apply the filter on the write path.
- ⚠️ **If an item's current value IS a hidden label, still display it** — rendered disabled/greyed
  ("Not Serving — not selectable"). If you filter it out of the options entirely, the select shows
  blank and the next save silently wipes a real value. The prototype demonstrates this.
- The send-off checklist deliberately treats `"Not Serving"` as *not satisfied*
  (`ProfilePage.tsx` ~line 284) — leave that alone.

The prototype implements all of this against a `BOARD_LABELS` object standing in for the fetched
settings; edit that object in the console and call `applyBoardDropdowns()` to watch new labels
appear and renames propagate.

### Corrections already applied in the prototype

| Field / column | Form or Corey mockup | Monday label (use this) |
|---|---|---|
| Pump Type `color_mm1wjjtk` | Tandem t:slim X2 · Tandem Mobi · Beta Bionics iLet | `t:slim` · `Mobi` · `iLet` · `Minimed 780G` · `Not Serving` |
| CGM Type `color_mm1w7pmf` | Medtronic Guardian 4 · "Any will work" | `Guardian 4` · `FreeStyle Libre 3 Plus` · `FreeStyle Libre 2 Plus` · `FreeStyle Libre 14-Day` · `Dexcom G7` · `Dexcom G7 15-Day` · `Dexcom G6` · `Instinct` · `Not Serving` |
| IP Coverage Path `color_mm1w5xn1` | Replacement (lost/damaged) · Warranty replacement · Upgrade from current pump | `1st Pump <6M Diagnosed` · `1st Pump >6M Diagnosed` · `OOW Pump` · `IW New Insurance` · `Omnipod Switch` · `Supplies Only` · `Not Serving` |
| CGM Coverage Path `color_mm1w7e5q` | Injecting insulin · Hypoglycemic event · Neither applies | `Insulin` · `Hypo` (reps read "Hypoglycemia" — display alias, `selectOptions.displayFor`) · `Neither Applies` · `Not Serving`. Both changed 2026-08-20: the form's third answer got a label of its own, and index 1 was renamed `Hypoglycemia` → `Hypo` so this board matches every board downstream and the value stops being blanked at Evaluate. |
| General Insurance `color_mm24ap4j` | Anthem or Blue Cross Blue Shield · UnitedHealthcare · NYS Medicaid · Medicare · Other | `Anthem / BCBS` · `United Healthcare` · `Medicaid` · `Medicare A&B` (+ `UMR`, `Wellcare`, `MagnaCare`, `Midlands Choice`; **no "Other"**) |
| Secondary Insurance `color_mm1zbrx0` | + Other | `NY Medicaid` · `Medicare Supplement` · `None` |

### 5.1 ✅ DECIDED — every field states its provenance in the UI

> ### ⚠️ THESE STAMPS ARE BUILD NOTES — THEY DO NOT SHIP
>
> **Every one of the little tags under the fields (`FROM FORM → color_mm1w7pmf`, `NEW COLUMN
> NEEDED`, etc.) exists purely to tell you where each value comes from and where it lands.
> NONE of them render in production.** Strip them all when you build. They are documentation
> printed onto the mockup so the mapping can't drift away from the design.

**Every** input on both panes carries one, so nothing is ambiguous:

| Tag | Meaning |
|---|---|
| `FROM FORM` | the patient answered it on the intake form |
| `REP · ON CALL` | the rep enters it during the call — deliberately not on the form |
| `SUGGESTED` | pre-populated by the suggestion engine, rep-editable (right pane) |
| `DERIVED` | computed, never typed (e.g. Request Type) |
| `REP PICKS` | chosen from a lookup, e.g. the doctor database |
| `→ NEW COLUMN NEEDED` | amber — the destination column does not exist yet (see §9) |

For each field the tag is the **declared source of truth** and the column is **where it lands**.
If a field has no stamp, its mapping is undecided — flag it rather than guessing.

**Request Type** `color_mm1w1978` is **derived**, never typed: categories + pump need →
`CGM` / `Insulin Pump` / `Supplies Only` / `Insulin Pump + CGM` / `Supplies + CGM`.
The field is labelled simply **"Request Type"** on screen — the `DERIVED → color_mm1w1978` stamp
underneath it is a note to you, not a label the rep sees.

---

## 6. Doctor section

✅ **DECIDED — form → UI mapping**
- Form *"Provider name (or clinic name)"* → **Doctor Name**
- Form *"Clinic phone or location"* → **Clinic Phone**

### 6.0 ✅ DECIDED — provided doctor info gets its OWN new columns

There are **two separate sets** of doctor fields and they do not share columns.

| | Columns | Written by | Moves to Medical Evaluation? |
|---|---|---|---|
| **Provided** — what the patient told us | 🟡 **NEW** (see §9): Provided Doctor Name · Provided Clinic Phone · Provided Clinic Address · Doctor helpful links / identification info | intake form / referral + rep on the call. **Write-once — never overwritten.** | **No** — reference and audit only |
| **Verified** — who we actually send to | `text_mm1x46et` name · `phone_mm1xz8c0` phone · `text_mm1x7d91` NPI · `color_mm1xw7y5` clinicals method · `email_mm1x6fq5` email · `email_mm1xdzcj` fax · `dropdown_mm1xbvas` clinic · `location_mm1xjnfv` address · `color_mm1ychz8` doctor status | **Select Correct Provider**, from the Doctor DB | **Yes** — these are what the automation copies forward |

**So: Select Correct Provider does NOT overwrite the provided values.** It writes the verified
columns, and those are what carry to the next board. The provided values stop being
operationally useful once a provider is picked, but they persist.

⚠️ **This is a change from how it works today, and the current behavior is the trap.** Right now
there is only *one* set of doctor columns: the referral's values are written into
`text_mm1x46et` / `phone_mm1xz8c0` / `location_mm1xjnfv`, and picking from the Doctor Database
**overwrites them**. The "Provided Doctor Info" card on `/profile` is *not* reading a stored
value — it's an in-memory snapshot (`receivedRef` in `useMondayPatients.ts`) of the first values
seen **this session**. Refresh the page and the original is gone; after the first save it's gone
from Monday too.

**Why the new columns are worth it:**
1. **Audit.** When MN later finds the NPI doesn't match the clinicals — same name, different NPI,
   a recurring failure — the rep needs what the patient originally said in order to re-search.
   Today that is unrecoverable.
2. **The form's answer isn't clean data.** "Clinic phone **or** location" is a single free-text
   field that may hold either, so it can't be written into a phone column without guessing. It
   needs a home of its own regardless.
3. It costs 4 write-once columns.

✅ **DECIDED — both doctor fields on the form are REQUIRED.** Remove the "optional" wording and
enforce it — Continue must block. Full validation spec in **§8.1**.

### 6.1 ✅ DECIDED — Select Correct Provider is the EXISTING component, unchanged

**Do not rebuild this section.** It must be `src/components/profile/DoctorSection.tsx` exactly as
it works on `/profile` today — same search, same doctor card, same location grid, same Parachute
panel, same notes/followers. The prototype reproduces it 1:1 so the two can be diffed.

That means all of this stays as-is:

- Search by **name or NPI**, debounced, dropdown grouped by **profile** (distinct name spelling +
  NPI) with a `N locations` chip. Two spellings under one NPI stay two selectable rows.
- **"Not in DB? Check Parachute"** panel — name/NPI search, results grouped by the patient's
  **phone area-code state** first ("📍 NY — matches phone area code (315)") then Other states,
  each row showing signed-order count and a Parachute/Fax method pill, and an
  **Add Doctor to Database** action that prefills from the selected candidate.
- **Doctor card** — initials tile, name · NPI, "N locations on file".
- **Location grid**, 2-wide, one card per DB item, with the **"matches referral"** badge
  (phone match first, then clinic/address), method pill, and **Edit selected location** /
  **+ Add another location**.
- **Doctor Notes + Order Followers**, greyed out until a location is picked, with the
  "⚠ Select a location above…" warning — they read/write that specific profile's columns.
- The **Method is Fax — no fax on file** error banner, which blocks send-off.
- Fax is stored in an **email** column on both boards, so it saves as `<number>@rcfax.com`.

### 6.2 ✅ DECIDED — Parachute order count renders INLINE and persists

**Confirm Parachute Order Count** must behave exactly as it does today: the button is replaced
**in place** by a persistent result line inside the doctor card —

> ✓ **43 signed orders** on Parachute   (green when > 15)
> ✗ **0 signed orders** on Parachute    (red when ≤ 15)

**Not a toast.** Not a banner that fades. The rep needs it on screen while they decide the
clinicals method, and it must survive picking a different location (the count is per **NPI**,
not per location). Threshold is **> 15 → Parachute**, otherwise Fax/Email. The rep still has to
verify the returned NPI matches the clinicals — same names, different NPIs.

Adding a doctor writes a new item to board `18142847597`.

✅ **DECIDED — section ordering.** The UI shows insurance *before* doctor while the form asks
doctor *before* insurance. This is intentional; do not "fix" it.

---

## 7. Scheduling / Calendly

✅ **DECIDED**
- Real **Calendly integration** — not fixed placeholder slots.
- Show only the **next 2–3 days** of availability.
- Enforce a **scheduling buffer of at least a couple of hours** from now.
- Send a Calendly link when the patient **requests a call** on the form, **and** as part of the
  **drop-off** follow-up sequence.
- The UI needs both **scheduled** and **unscheduled** states for a patient.

🟡 **OPEN:** whether the rep can *book* a slot from the UI, or only view a booking the patient
already made. (Question was "Confirm booking shouldn't be on the UI right?" — needs an answer.)

---

## 7.2 ✅ DECIDED — call booking behavior

The **Preferred call time is the patient's answer to the last question on the form.** The UI
**displays** it — the rep does not have to re-enter it.

- Show the form-selected slot, plus a clear **Scheduled / Unscheduled** status.
- The rep **can override it**: pick a different opening from the dropdown and press
  **Confirm booking**. That replaces the patient's slot and is what carries forward.
- **The form's slot picker AND this dropdown must both read live Calendly openings** — same
  source, so the two can't disagree. Next 2–3 days only, minimum ~2-hour buffer from now (§7).

### ✅ DECIDED — "Intake Call Complete" and when it appears

A checkbox that is the rep-side equivalent of the patient saying "send it now": once the intake
call is done the rep ticks it, satisfying condition 1 of the unlock rule (§2). Needs its own
Monday column.

**Its visibility depends on the proceed preference:**

| Proceed preference | Call booking block | Intake Call Complete |
|---|---|---|
| **Send request now** | hidden | **hidden** — the patient already authorised us, so the checkbox is irrelevant and must not be shown |
| **Wants a call first** | shown | shown, **positioned below** the booking block |
| *no selection yet* | hidden | shown — the rep may have taken the call before that form question was ever answered |

---

## 7.1 Other open UI questions

🟡 **OPEN — is CGM Data & Doctor Awareness conditional in the rep UI?** It is deliberately not on
the form (phone-call only), but it was originally conditional on the CGM Coverage Path being
`Hypoglycemia`. In the prototype it now shows whenever the CGM category is on, because hiding it
broke row alignment with the pump column. Confirm which behavior is wanted.

🟡 **OPEN — is Cost & Coverage gated on the reason?** Corey's mockup revealed the
*Cost & Coverage* card only when Reason for Inquiry = pharmacy cost. In the prototype the card is
now **always visible** and simply highlights on the pharmacy reason, because hiding it made the
section easy to miss entirely. Confirm whether the gate should come back.

✅ **DECIDED — an unselected product category hides its entire column.** When CGM or Insulin Pump
is switched off, that whole column of fields disappears (it does not grey out). Because the fields
only exist when the category is selected, **the individual field boxes are not highlighted** — the
category toggle itself is the only thing that carries the selected state.

---

## 8. Form changes for Josh

> These are **form-only** changes. Nothing in this section requires a change to the rep UI design.

### 8.1 ✅ DECIDED — REQUIRED FIELD ENFORCEMENT (form)

**This is the single most important form change.** Today the asterisks on the form are
**decorative** — every field is marked `*` but nothing blocks. On both the demographics step and
the doctor step, Continue is hardcoded as `continueBtn('go(N)', false)`, so the disabled flag is
permanently `false` and a patient can advance through both screens having typed nothing.

**Required behavior:** the Continue button is **disabled** until every field below holds a valid
value, exactly the way the insurance step already works via `canContinueStep5()`. Validation runs
on input, not only on submit, so the button enables live as the patient fills the form.

**Step 2 — Basic demographics. All fields required:**

| Field | Validation |
|---|---|
| First name | non-empty after trim |
| Last name | non-empty after trim |
| Phone | 10 digits (the existing `formatPhone` mask already normalizes) |
| Date of birth | non-empty, valid MM/DD/YYYY, not a future date |
| Email | non-empty, valid email format |
| **State** | non-empty — see §8.2 |

**Step 4 — Doctor info. BOTH fields required:**

| Field | Validation |
|---|---|
| Provider name (or clinic name) | non-empty after trim |
| Clinic phone or location | non-empty after trim |

Also **remove the "optional" wording** from the doctor step — both the `— optional, either works`
hint text and any `optional-tag` styling. The fields are required; the copy must say so and the
button must enforce it.

> Why this matters downstream: a patient who skips DOB or phone cannot be matched or called, and
> a blank state means `primaryInsurance.ts` returns **no suggestion at all** (see §8.2). Missing
> doctor info means the referral can't be routed to a provider. Every one of these lands as a
> manual rep chase — which is precisely what this project is meant to eliminate.

### 8.2 ✅ DECIDED — other form changes

- **State moves up into basic demographics** (already done in the 8.4 mockup). It is *not* only
  needed for Medicare/Medicaid — `primaryInsurance.ts` resolves home state **first** and returns
  no suggestion without it; it drives Anthem/BCBS routing, the POS 11 out-of-state rule and the
  home-plan mismatch warning. It must also no longer be asked again on the insurance step.
- **Remove "— collect on call" from Email** — we get email from the form.
- Reason wording: *"I need a new supplier"* and *"I want off the finger prick / try a pump"*
  (already in the 8.4 mockup).

✅ **DECIDED — deliberately NOT on the form**
- **CGM data & doctor awareness** — phone-call only, rep-entered. Stays in the UI, not the form.
- **Insulin pump coverage path** — left off intentionally; anyone wanting a pump requires a call.

✅ **DECIDED — CGM data upload flow.** Full spec in **§8.3**.

### 8.3 ✅ DECIDED — "Send photo upload link to patient" (CGM data)

This is the mechanism behind the button in the rep UI. It is **not** a file picker for the rep —
it is a link we send to the patient so *they* can upload from their phone while on the call.

**The flow, end to end:**

1. Rep is on a call with the patient and clicks **Send photo upload link to patient**.
2. The system generates a **unique, tokenized upload URL scoped to that patient's Monday item**
   and sends it to the patient (see open questions for channel).
3. The patient opens the link on their phone. It is a **dead-simple, no-login upload page** —
   one big "take a photo / choose file" control, no account, no app, works in a mobile browser.
   Accept photos and files: `.jpg`, `.png`, `.heic`, `.pdf`, `.csv`.
4. Patient hits submit.
5. The file is written to a **new `CGM Data File` file column** on that patient's Monday item.
6. The rep UI picks it up and the file **appears in the CGM Data File area of the left pane**.

**✅ DECIDED — the file behaves exactly like every other file in Command Center.** Use the
existing `file-row` / drop-zone pattern, nothing bespoke:

- **Click the row to view it** — opens the same in-app viewer as the referral files (zoom,
  download, close). This is how the rep confirms on the call that the patient uploaded the right
  thing. Must work for photos (`.jpg` / `.png` / `.heic`), PDFs and CSVs.
- **✕ on the row removes it.**
- **When empty, a drop-zone takes its place** — drag and drop a file onto it, or click to choose.
  This is how the rep attaches the data manually if the patient can't use the link.

**Requirements**
- The token must resolve to exactly one Monday item. No patient identifiers in the URL.
- Uploading must work **while the rep is still on the call** — the UI needs to reflect the new
  file without a manual page refresh (poll, same as the Stedi settle watcher).
- Log both events in the patient message log: link sent, and file received (with timestamp).
- The rep can still upload manually on the patient's behalf — the drop zone stays.

🟡 **OPEN**
- **Channel:** SMS (RingCentral, already wired for outbound texts), email, or both?
- **Expiry:** how long is the link valid?
- **Multiple uploads:** does a second upload append a new file or replace the first?


---

## 9. New Monday columns needed

🟡 **OPEN — needs to be created before the UI can write.**

> **Two whole sections of Corey's mockup have no backing columns at all** — *Care Assessment*
> (Self Advocacy) and *Cost & Coverage* (Current Out-of-Pocket Cost). They are rep-entered on the
> call, both optional, and both need new columns before the UI can persist anything. Right now
> they render but write nowhere.

| Field | Notes |
|---|---|
| **Care Coordinator Owner** | ✅ decided — add now, likely a **dropdown**. Enables Phase 3 (Care Coordinator dashboard) without a later migration. |
| Reason for Inquiry | from the form. Status column; labels = the four form reasons (`Pharmacy is too expensive` · `Denied by insurance` · `I need a new supplier` · `I want off the finger prick / try a pump`). |
| **Pump Need** | from the form — `Need a new pump` / `Only need supplies`. No board column exists today; it is an input to the derived Request Type and to Insulin Pump Coverage Path. |
| **Self Advocacy** (Care Assessment) | rep-entered on the call. Status column, labels `High` / `Low`. Optional — must tolerate blank. |
| **Current Out-of-Pocket Cost** (Cost & Coverage) | rep-entered on the call. **Text** column, not numeric — reps capture things like `$75/month`, `$400 per 90 days`. Optional — must tolerate blank. |
| CGM Data & Doctor Awareness | rep-entered on the call. Status column, labels `Patient has existing data` · `Doctor is aware` · `Neither applies` · `Both apply`. |
| **CGM Data File** | **File** column. Written by the patient upload link — see §8.3. Must be readable back into the UI for preview. |
| Secondary Insurance (as provided) | **status/dropdown** using the form's payer list (Humana, Aetna, …). Distinct from the right-pane board-label version — see §4.1. |
| Secondary Member ID (as provided) | free text, optional |
| Insurance provided via | `Photo of card` / `Entered manually` / `Not provided` |
| Insurance card photo | **File** column |
| Provided Doctor Name | from the form's "Provider name (or clinic name)" — distinct from the *verified* doctor picked on the right, which writes `text_mm1x46et` |
| Provided Clinic Phone | from the form's "Clinic phone or location" |
| Provided Clinic Address | rep-entered on the call |
| Doctor helpful links / identification info | rep-entered, long text |
| Proceed preference | `Send request now` / `Wants a call first` — the last question on the form |
| **Intake Call Complete** | checkbox / status. Rep-set. Gates the advance — see §2 and §7.2. |
| Call slot — as selected on form | the patient's Calendly pick |
| Call slot — rep override | set when the rep confirms a different opening |
| Booking status | `Scheduled` / `Unscheduled` |
| Secondary Insurance (as provided) | the form's raw payer answer — see §4.1 |
| Call time / scheduled slot | plus scheduled vs unscheduled state |
| Attempt counter | see §10 |

Deferred with the OOP work: 3-month / 6-month OOP columns. The board today has only
First-Order `text_mm4tvsk6` and Recurring `text_mm4ttaa6`.

---

## 10. Still open — do not build yet

- **One attempt counter, or several?** 2 automated (email + text ×2) + 5 autodialer + manual rep
  calls all need to roll into one number, or the escalation logic can't be trusted.
- **Form platform** — JotForm rebuild or custom? Determines whether resume links and drop-off
  tracking are free or net-new. (DTC Intake already has `JotForm submission ID`,
  `Drop-off Page`, `Last Seen` feeding the `Partial Leads` group.)
- **When the Monday item is created** — must be at **form step 2**, the moment we have
  name/phone/email, or drop-off messaging has nothing to message.
- **Autodialer vendor** — RingCentral or net-new procurement.
- **TCPA / consent capture** on the form for autodialing and texting.
- **Dedupe on submit** — a returning patient should hit `Already In System` `color_mm2xe7r8`,
  not create a duplicate.
- **Escalation destination** (§2).
- **Cold campaign** — undefined; DTC has empty `Cold Leads` / `Cold Lead Campaign` groups.
- **One board or two** (§1).

---

## 11. Things explicitly deprioritized

- **Tags — REMOVED.** The whole tags concept from Corey's mockup (auto-tags, "+ Add tag",
  event tags) is gone. Do not build it, and no tag column is needed.
- **Full benefits / OOP estimate** — deferred pending Corey's plan-level research (§3).
- **Doctor / manufacturer referral UI** — after this one ships (§1).

## 12. Confirmed doable

- **Viewing patient emails** in the UI — should be doable, keep it in scope.
