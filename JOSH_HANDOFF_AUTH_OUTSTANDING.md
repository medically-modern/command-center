# Auth Outstanding Redesign — Backend Handoff Notes (for Josh)

Working notes collected while designing `auth-outstanding-redesign.html` (UI-only prototype, July 2026).
The prototype is the visual/behavioral spec; this doc covers what the backend needs to do differently
from the current live Auth Outstanding tab. Logic mirrors `AuthOutstandingPage.tsx` +
`AuthOutstandingPanel.tsx` + the `authOutstanding` branch of `lib/samantha/mondayWrite.ts` unless noted.

---

## 1. The daily-check workflow — partial saves are a first-class thing

Reps open this page **every day** for each patient with a submitted auth. Three outcomes per check:

- **Nothing back from the payer yet** → rep does nothing, moves on. No write.
- **Result came back** → rep records it on the product's card.
- **Result = No Auth Needed** → rep saves it immediately, but the **Same-or-Similar recheck happens
  on a later call**. This is the case that needs new write support (§4).

The page is one step — "**(1) Record the Auth Result for Each Product**" — with one card per tracked
product (auth status = Submitted on the board, non-DVS-routed).

## 2. Card layout: left = what Submit Auth recorded, right = result entry

Left panel is **read-only**, straight off the board from the Submit Auth stage: Submitted Via,
Submitted On, Auth ID (if one was captured at submission), Phone/Fax number (call/fax submissions),
Intake ID (Carecentrix). Right panel is the entry: **Auth Valid / Denied / No Auth Needed**.

**Card height rule:** a card's result zone is locked to its **tallest possible state** — measured at
runtime for that card at the current viewport width (the prototype's `equalizeHeights()`), not a
hard-coded pixel value. So the card never grows or shrinks when the rep switches between Auth
Valid / Denied / No Auth Needed, and it ends flush right below its tallest content (the upload box
on call/fax cards) with zero filler. Match this in the build.

## 3. Per-result behavior + writes

**Auth Valid** → required: Auth ID, Auth Start, Auth End, Units. All four write to the product's
existing per-product auth columns (CGM/Sensors/Insulin pump/Infusion set/Cartridges auth result +
auth ID/start/end) **plus Units** (same new-Units treatment as the Benefits handoff).

**Denied** → nothing else required. The card shows a **denial-reason upload** (optional — do NOT
gate on it): the file goes to **Final Clinicals (`file_mm25m8c1`)**, see §5. Escalation is automatic (§6).

**No Auth Needed** → wipes any auth ID/start/end/units for that product, and opens the
**Same-or-Similar recheck** (same derived model as the new Benefits tab):

- Rep records **Last Bill Date + Units**, OR **No Billing History**. Clear / Not Clear is **derived,
  never shown to the rep** — write the derived value to the same SoS columns as today.
- Lookbacks: pump (E0784) + monitor (E2103) = **4 years**; sensors/IS/cartridges = **90 days**,
  or **60 days** when the patient has Medicaid (primary or secondary).
- Next Order Date keeps the existing math off the entered Last Bill Date.

## 4. NEW: per-product save without a stage change ("Save No Auth Needed")

When No Auth Needed is selected, the recheck box header has a **Save No Auth Needed** button.
It writes **that one product's auth-result column** (and wipes its auth fields) **without touching
Stage Advancer or anything else**. The recheck stays open — the rep comes back after the SoS call,
fills Last Bill Date + Units (or No Billing History), and only then does the page-level complete
(§6) become possible.

This needs a Monday write path that can write a single product's columns with **no stage/escalation
side effects**. Until the recheck is filled, the card shows "SoS recheck pending" — nothing else is
persisted for it.

## 5. File uploads — everything goes to Final Clinicals (`file_mm25m8c1`)

**All files uploaded anywhere on this page land in the Final Clinicals file column: `file_mm25m8c1`.**

Two upload surfaces (the old topbar "Upload Final Clinicals" button is **gone** — don't port it):

- **Auth docs drag-and-drop** — appears on a product card only when it was **Submitted via Call or
  Fax** AND the result is **Auth Valid or No Auth Needed**. Portal/Availity submissions never show it
  (the record already exists in the portal). Multiple files, drag-and-drop or click-to-browse.
- **Denial reason upload** — appears when result = **Denied**. Single file, optional (never blocks
  complete or save).

Both are additive — append to the column, don't replace existing files.

## 6. Stage / escalation rules on "Auth Review Complete"

The **Auth Review Complete** button is the only stage-mover. Gating (client + server): every tracked
card has a result; Auth Valid cards have ID + start + end + units; No Auth Needed cards have a
complete recheck. DVS-routed products do NOT gate this page (§7).

- **Any product Denied** → Stage Advancer = **Auth Denied**, Escalation = **Escalation Required**.
  Escalation is **denial-driven only** — the manual Escalate button was removed from this page.
- **Everything resolved** (each tracked card Auth Valid or No Auth Needed w/ recheck complete)
  → Stage Advancer = **Complete**.
- **Partial** (e.g. saved No Auth Needed awaiting its recheck) → stage untouched.

## 7. DVS: NOTHING on this page

**Nothing DVS-related renders on this view.** DVS is getting its own dedicated view after this one —
the E-paces tracker, DVS/Claims status chips, and the "Mark Supplies Auth Valid" (old "Claims Paid —
Mark Complete") flow all move there. On Auth Outstanding, the only DVS trace is the **gray
"DVS Required" pill** in the Auth Status matrix, and DVS-routed products get no result card, don't
block Complete, and get no writes from this page. A patient whose products are ALL DVS-routed shows
the empty state ("handled at the DVS stage") and this page never advances their stage.

## 8. Auth Status by Product matrix (top of page) — display semantics

Read-only, from the board. Color language (deliberate, from Brandon): **Submitted = light blue**
("check this one today"); **everything with no action on this view is gray** — No Auth Needed /
resolved (grayed out), **DVS Required (gray, a touch darker than Not Serving — real status, but
handled on the DVS view)**, Not Serving (most faded). Required = amber. No green/mint emphasis on
no-action cells, no blue on DVS.

## 9. BCBS home-plan banner

Same rule as Submit Auth: BCBS-family primary whose Stedi **home plan ≠ billed plan** → banner
"Auth status checks go through the member's home plan — {home plan} {phone}". Home plan from the
271 (`_parse_home_plan` canonical names); phone from the payer directory effort (Janelle/Sam).

## 10. Demo scaffolding — strip before production

- **Serving / Primary / Secondary dropdowns** in the header are tagged DEMO (testing combos only).
  Header is read-only in production, fed by Profile Send-Off.
- **Monday Board Output drawer** — testing aid showing exactly what each column write should be.
  Keep it while implementing to verify writes, then delete. The **Auth Review Complete button +
  "Needed before" list live in their own card below the drawer** and stay when the drawer goes.
- Demo scenario switcher bar (top of page).

## 11. Not ported from the old page (confirm before deleting for good)

- Manual **Escalate** button (escalation is denial-driven now, §6).
- Topbar **Upload Final Clinicals** button (replaced by the per-card surfaces, §5).
- **Follow Up modal** — superseded by the "Auth Still Outstanding" button (§12), which covers the
  only follow-up action this page needs.
- Old rep-facing Clear/Not-Clear SoS dropdowns (derived now, §3).

Open questions for Brandon: whether straight-Medicaid patients hit this page at all (shared
question with Submit Auth / DVS stage design).

## 12. Daily bucket (NEW 2026-07-20) — sidebar filter, Still Outstanding, days-outstanding column

The goal: the rep can **clear her bucket every day** — every patient due today gets either a
recorded result or one click of "Auth Still Outstanding".

**Sidebar: KEEP THE EXISTING PatientsSidebar FORMAT.** The live app's side panel is already
correct — same component, same look, same behavior as the other stages. The rail in the UI mockup
is an approximation and is NOT the visual spec; don't restyle anything to match it. What changes is
only the data feeding it:

- **Bucket filter:** the Auth Outstanding list shows only patients whose **Follow Up Date
  (`date_mm34m2dz`) is today or earlier**. (Submit Auth now stamps Follow Up = same-day on
  submission — see the Submit Auth handoff §7 — so patients appear in the bucket the day after
  submission at the latest.)
- **Group by payer** (primary insurance) — the sidebar's existing group-by-insurance mode becomes
  the default for this stage.
- **Days outstanding on each row** — the sidebar already shows days-since-stage for Auth
  Outstanding; keep that, sourced from the new column below.

**"Auth Still Outstanding" button** — top of the patient view, right-aligned (in the mockup it sits
in the patient header card). One write, nothing else: **Follow Up Date (`date_mm34m2dz`) →
tomorrow**. No stage change, no escalation, no per-product writes. That removes the patient from
today's bucket; they reappear tomorrow. (Recording results + Auth Review Complete is the other way
out of the bucket — the stage moves and they leave the list entirely.)

**NEW Monday column — "Days Auth Outstanding":** a number column counting days since the auth was
submitted (earliest Auth Submission Date across the patient's products). Backend keeps it current
(daily recalc or computed on read — Josh's call). Displayed next to the patient name at the top of
the page ("N days outstanding" badge) and on the sidebar rows. We want it as a real column — not
just a frontend diff — because we'll likely want it later as a **filter and an automation trigger**
(e.g. auto-escalate at N days).
