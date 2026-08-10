# Handoff — Patient Intake (DTC & CareCentrix) build state, 2026-08-07

Continues the stage at `/unverified-referrals` (role id `unverifiedReferrals`,
label **Patient Intake — DTC & CareCentrix**). Everything below is on `main`.

## ⚠️ Read these two FIRST — they are now in the repo

| File | What it is |
|---|---|
| [`patient-intake-redesign.html`](patient-intake-redesign.html) | **THE SPEC.** Corey's mockup. Open it in a browser. Its stylesheet is `redesign.css` (PART A, already live) + the additions in `src/pages/profile/intake.css` (PART B). |
| [`HANDOFF_PATIENT_INTAKE.md`](HANDOFF_PATIENT_INTAKE.md) | Josh's written spec — the §-numbers this code cites (§2 unlock rule, §3 benefits check, §4 pre-fill, §5.2 index writes, §6.0 provided-vs-verified, §7.2 booking, §9 columns, §10 do-not-build). |

Both were missing for most of the session that built this, which is exactly how
the layout drifted. **Do not rebuild from the section headings — port the
mockup's markup.** That mistake is described in "What is NOT done" below.

> **The mockup's `NEW COLUMN NEEDED` stamps are STALE.** Those columns were
> created after it was written. Verified against the live board 2026-08-07:
> every field in the mockup already has its Monday column. See the inventory
> below — **the remaining work is pure front-end.**

> **The little `FROM FORM → color_xxx` stamps under every field are BUILD
> NOTES, not UI.** HANDOFF's preamble is explicit: "They are NOT part of the
> design and must NOT appear in production." A `<Prov>` component that rendered
> them was deleted; don't reintroduce it.

---

## What IS done (11 commits, `0816726`..`981b293`)

**Layout / shell**
- Two-pane split now driven by a **container query** on `.panes-host`, not a
  viewport media query. The old `@media (max-width:1500px)` collapsed the split
  on every ordinary laptop — the panes never get the whole window (the sidebar
  takes ~256px). Splits at 1440px open, and at 1280px with the sidebar
  collapsed. `intake.css` top comment has the reasoning.
- **Panes actually scroll.** `.panes-host` had no `min-height:0`, so the flex
  child refused to shrink, panes grew to content height, nothing overflowed —
  and `overscroll-behavior:contain` then ate the wheel, leaving only the
  scrollbar. Page root is `h-screen overflow-hidden`; split hands scrolling to
  the two columns, stacked keeps `.panes` as one scroller.
- Sidebar has exactly two filters (**Completed forms** / **Partial forms**),
  rendered through a new optional `filters` slot on `PatientsSidebar`
  (Verified Referrals omits it, unchanged). The old "Referrals" tab is gone —
  that's `1. Intake`, the stage this one advances INTO.

**Right pane — matches the mockup's four numbered steps**
1 Verified Insurance · 2 Serving & Coverage · 3 Select Correct Provider ·
4 Ready to Send Off? → **Advance to MN**.
`.step-head` / `.step-num` / `.route-grid` / `.route` ported from the mockup.

**Backend**
- **Doctor columns now save.** Was the worst bug: `DoctorSection` reported picks
  into an in-memory overlay and nothing persisted the eight verified doctor
  columns, so the rep's provider work was discarded on every advance.
- **Advance is verified.** `advanceToMedicalNecessity(p, clinicLabelId)` follows
  `mondayWrite.sendPatientToMonday`'s contract: save left pane → write verified
  insurance → `executeWritesWithVerification` writes the doctor columns and
  reads them all back → **only then** writes `Move to Onboarding = Advance to
  MN`. Verification timeout throws and does NOT advance.
- **Propose Stuck climbs the shared ladder** (`stageActions.proposeStuckLevel`,
  `unverified-intake` starts at `manager`): rep → Manager Intervention, manager
  from there → Final Decisions. It used to write Final unconditionally.
- **Escalation notes no longer wipe history.** `setEscalation` reads the current
  log before appending — `StageActionBar` can't pass it, and
  `appendNote(undefined, …)` was writing only the new line.
- Notes use `shared/noteStamp` (**ET + stage + initials**); they were
  `toISOString()` = UTC, so anything after 8pm ET was dated the next day.
- Editable + writing: Name, Phone, DOB, Email, State, Referral Source/Type,
  Request Type, both Coverage Paths, General Insurance, Serving.

**Oversight** — escalated intake patients were invisible **app-wide** (3 stacked
gaps: charts in no section, no `CHART_ROUTES` entries, page read `?origin=` when
the param is `?mv=`). Intake now has the 3-column manager scheme scoped to the
Unverified queue.

**Counting contract (§5.8)** — all three now agree on the DTC form groups:
`useRoleCounts.ts`, `scripts/snapshot-baseline.mjs`,
`services/baseline-cron/index.mjs`. They were causing phantom "+N in" chips
daily. *Not verified by running them — they need a gateway token.*

---

## What is NOT done — the left pane

**This is the main outstanding work.** The right pane matches the mockup; the
left one is still a paraphrase. Port it section by section from
`patient-intake-redesign.html`, in this order:

| Mockup section | State |
|---|---|
| Referral Email card + "Show referral email / updates" | **missing** — use `fetchUpdates()` |
| Files — click to preview | **missing** — `fetchItemAssets()` + `FileViewerModal` |
| Patient Demographics | wrong: needs **First/Last split**, **Gender**, **Address** |
| What They Need | wrong: mockup is **Product Categories checkboxes** revealing Pump Type / Pump Need / Coverage Path |
| Care Assessment | merged into my "On the call"; needs its own card + **segmented High/Low** |
| Cost & Coverage | same — own card |
| Provided Insurance | dropdown; mockup uses a **segmented** 3-up for Provided via, plus **Start Insurance Follow-Up** |
| Benefits Check Output | **DO NOT BUILD** (§3/§10, pending Corey's research) |
| Provided Doctor Info | present, roughly right |
| Proceed Preference | missing the booking **override** + Confirm booking |
| Patient Messages | **missing** |
| Call Log & Notes | **missing entirely** — no notes UI exists, though `notes` is in the save payload |
| Ready to Advance? | flat button row; mockup uses **`.route` cards** |

**Address is a real data gap**, not just cosmetic — `location_mm1xhw17` is empty
on every form patient and downstream stages need it for shipping.

### Backend inventory — nothing is blocked

Verified against the live board 2026-08-07. Every mockup field has its column:
Gender `color_mm1x1bdg` · Address `location_mm1xhw17` · Reason `color_mm5zb8h6` ·
Pump Type `color_mm1wjjtk` · Pump Need `color_mm5zsfmj` · IP Path `color_mm1w5xn1` ·
Self Advocacy `color_mm5z31hs` · OOP Cost `text_mm5zj2q1` · Provided via
`color_mm5zv5pa` · Secondary `color_mm5zh2af` / `text_mm5ztdq9` · Follow Up
`color_mm3822qq` / `date_mm3874an` · Notes `text_mm389fs`. First/Last = the item
`name`, no column needed.

---

## Other open items

1. **Queue definition.** Josh wants Verified Referrals keyed off `1. Intake` and
   Patient Intake off the two form groups. **Not done** — it moves ~90 live
   patients between queues. `1. Intake` holds ~100 items, ~90 with Referral Type
   `Patient`, and **all of them have `Drop-off Step` and `Form Session ID`
   empty** (they predate the new form). Their partial/completed state lives on
   **DTC Intake `18392794310`** (`Partial Leads` group, `JotForm submission ID`,
   `Drop-off Page`). Josh said he'll sort the board himself. Changing this is a
   5-file change per §5.10.
2. **Monday automation `7921666432`** — *when item created + Referral Source is
   CareCentrix → move to New Form — Completed*. Josh fixed its condition by
   hand after the MCP tool built it with the wrong value; **verify before
   trusting it**.
3. **Insurance card photo** (`file_mm5zhy1`) is fetched but never mapped into
   `Patient`, so the rep can't view it. Josh explicitly deprioritised this.
4. **`Approve Stuck` is close to a no-op here** — it writes index 2, which the
   patient already has, and never moves them to the Stuck group.
5. **`intakeCallComplete` can't be un-ticked** (write-only-when-truthy).
6. 23 pre-existing typecheck errors on `main`, none in this slice.

---

## Test data on the live board

Two fake patients in **New Form — Completed** (`group_mm5zgeak`), safe to delete:

| Name | Item | Use |
|---|---|---|
| `ZZ TEST - Locked Pane (delete me)` | `12749042292` | Proceed Preference = *Wants a call first* → right pane **locked**, one tick from unlocking |
| `ZZ TEST - Unlocked Pane (delete me)` | `12749065376` | *Send request now* + full fake Stedi → right pane **open** |

Both count in the role bar and burndown while they exist.

**The doctor write has not been exercised against a live patient** — it needs a
browser session with the Monday token. Use the unlocked one: pick a provider in
step 3, hit Advance to MN, then confirm Doctor Name / NPI / Fax are populated on
the board *before* the item moves to Completed.

---

## Conventions this stage follows

- Status columns are written **by index, never by label** (§5.2) — a label
  rename would break a label write silently, because Monday drops an unknown
  label without erroring. All 18 index maps were verified against the live board.
- **Provided ≠ verified** (§6.0): `writeIntakeEdits` never touches the verified
  doctor columns; the patient's own answers live in the `Provided *` columns.
- Every write is a separate task with `Promise.allSettled`, so one rejected
  column can't discard the rest — the UI reports "Saved, except: X".
- A blank field means *"not set"*, never *"clear the board"*. Guard every task.


---

## Spec conflicts found by actually reading HANDOFF_PATIENT_INTAKE.md

Added after re-reading the spec end to end. These are places the shipped code
disagrees with it — each cites the section.

### 1. Dropdown options must come from the BOARD, not hardcoded maps (§5.2)

CGM Type, Pump Type, CGM Coverage Path and Insulin Pump Coverage Path should
read their options from `columns { settings_str }` at runtime, so a board rename
or a new label flows through without a code edit. Shipped code uses the
hardcoded `*_INDEX` maps — the spec says outright "the filter is right; the
**source** is wrong."

Required shape: fetch settings once per session and cache · build a live
label↔index map · render sorted by `labels_positions_v2` · drop empty slots ·
filter `HIDDEN_LABELS = ["Not Serving"]` · **write by index** · keep the
hardcoded maps as a fallback so the dropdown is never empty.

> ⚠️ **The bug this creates today.** `noNotServing()` removes "Not Serving" from
> the OPTIONS entirely. The spec is explicit: if an item's current value IS a
> hidden label it must still render, greyed and unselectable — otherwise the
> select shows blank and a later save can wipe a real value. "Not Serving" is a
> legitimate written value (the cross-sell derivation writes it), it is only
> hidden from the *picker*. **Never apply the filter on the write path.**

### 2. The engine's reasoning is an ⓘ HOVER, and the confidence label is furniture (§4)

§4 says to remove "the suggestion chip, the confidence label, the state pin, the
runner-up alternates" and put the reasoning behind an ⓘ next to **Primary
Insurance** and **Serving**. The shipped `.why` note is always-visible and keeps
a `HIGH CONFIDENCE` pill.

⚠️ This is a genuine conflict, not an oversight: Josh asked in-session for the
reasoning to be readable *without clicking in*. The always-visible note is what
he asked for; the confidence pill is what §4 says to drop. **Get a ruling before
changing it.** Either way, hard blocks and MSP/MA/facility warnings stay as
visible banners — the hover is for explaining a normal pick, never for hiding a
problem.

### 3. Member ID 2 blocks the advance when Secondary = NY Medicaid (§4)

`writeVerifiedInsurance` refuses the write, but the step-4 **Ready to Send Off?**
checklist has no row for it — the mockup does ("Member ID 2 (required for NY
Medicaid)"). Add it so the block is visible before the rep hits Advance.

### 4. Product categories hide their whole column (§7.1)

"An unselected product category hides its **entire column**" — it does not grey
out, and the individual field boxes are not highlighted because the category
toggle carries the selected state. This is the checkbox-reveal behaviour in the
mockup's *What They Need*; shipped code has flat dropdowns.

### 5. Not built at all, and specced in detail

- **Calendly (§7, §7.2)** — real integration, next 2–3 days of availability, ~2h
  buffer. The booking-override dropdown and the form's slot picker must read the
  SAME live openings so they can't disagree. 🟡 OPEN: can the rep *book* from the
  UI, or only view the patient's booking?
- **CGM data upload (§8.3)** — "Send photo upload link to patient" generates a
  tokenized URL scoped to one Monday item; the patient uploads from their phone;
  the file lands in `CGM Data File` (`file_mm5zhsxh`, exists, currently unread)
  and appears in the left pane using the standard file-row + viewer + drop-zone
  pattern. 🟡 OPEN: channel, expiry, append-or-replace.

### 6. Still awaiting Josh (§7.1)

- Is **CGM Data & Doctor Awareness** conditional on CGM Coverage Path =
  `Hypoglycemia`, or always shown when the CGM category is on?
- Is **Cost & Coverage** gated on Reason = pharmacy cost, or always visible and
  merely highlighted?

### 7. Where the spec is now STALE

§9 says *Care Assessment* and *Cost & Coverage* "have no backing columns at all".
They do now — `color_mm5z31hs` and `text_mm5zj2q1` — and the page writes both.
Same for every other `NEW COLUMN NEEDED` stamp. Trust the live board over §9.
