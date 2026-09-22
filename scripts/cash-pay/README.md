# Cash Pay: the skip-to-Welcome-Call hop (CLAUDE.md §5.48)

**This is a monday-UI job for a person. Nothing here runs.** The app half is
built and dark behind `src/lib/profile/cashPayIntake.ts`
`CASH_PAY_SKIPS_TO_WELCOME_CALL = false`; this is the board half it is waiting
on, and the flag stays false until it is published.

## Why

A Cash Pay patient has no medical necessity to document and no auth to chase, so
they should skip **Medical Evaluation** and **Insurance** entirely (Corey,
2026-08-14) and land on **Welcome Call** straight from Profile Clean-Up.

⚠️ **The label already exists and firing it early is the failure mode.** Profile
Send Off's **Move to Onboarding** `color_mm1zmeb3` carries **"Advance to Welcome
Call"** (label id 6) on the live board. Writing it before this automation is
published lands a value nothing acts on: the item never leaves Profile
Clean-Up, and the rep has pressed a button that silently did nothing — §9's
advancer class, which cost five days of re-pressed Advance the last time.

⚠️ **Board automation 7917676280 is deliberately untouched.** It triggers on
**"Advance to MN"** (label id 1) specifically, so an insured patient's route
stays byte-identical. This is a SECOND automation beside it, not an edit to it.

⚠️ While the flag is false a cash pay patient still advances, on "Advance to
MN", exactly as today. Nobody is stranded either way; flipping it only changes
which board they land on.

## The automation

Host board: **Profile Send Off `18406352652`**. **Build all three steps from
scratch.**

⚠️ An earlier draft of this file said a draft workflow `18432110599` already
carried the trigger and the move-to-Completed step. **It does not exist.**
Checked against `list_automations` on 2026-09-22: that board has 18 workflows
and 16 legacy automations, none of them is `18432110599`, and **not one of them
names the Welcome Call board `18410804557` anywhere**. Josh reported the same
thing from the UI (*"i dont see a draft autoamtion"*). Take this page as the
whole job.

⚠️ **I could not build it from here, and it is worth knowing why before
trying again.** `create_automation` timed out three times on the 60-second MCP
ceiling — the 38-column mapping is simply a large payload — and each time the
board was re-checked and was verifiably unchanged, so nothing half-made is
lying around. The other path, `create_workflow`, creates an *empty* workflow
and needs `invoke_workflow_expert`'s `create-step` to fill it, which this
session does not have (only `get-step`). A partial automation is worse than
none: trigger + move-to-Completed without the create-item step would take a
patient out of the pipeline and put them nowhere.

All three verified against the live boards, 2026-09-22.

1. **Trigger** — When **Move to Onboarding** `color_mm1zmeb3` changes to
   **"Advance to Welcome Call"** (label id **6**; 7917676280's is id **1**,
   "Advance to MN"). The column's `done_colors` is already `[1, 6]`, so monday
   treats both as completing labels.
2. **Create item in board** — into **Welcome Call `18410804557`**, group
   **Welcome Call** `group_mm1wvq8p` (7917676280 uses `__top_group__`, which on
   Welcome Call resolves to the same group — name it explicitly anyway), item
   name = the trigger item's **Name**, with the 38 column mappings below.
3. **Move item to group** — the trigger item to Profile Send Off's **Completed**
   group `group_mm1y57sz`, which is exactly where 7917676280 puts it.

⚠️ Steps 2 and 3 in that ORDER, matching 7917676280: the create reads the
trigger item's columns, and moving it first is a race nobody needs.

## The mapping — 38 columns

Derived 2026-09-22 by chaining the three live hop automations that a column
must survive today to reach Welcome Call — **7917676280** (Profile Send Off →
Medical Evaluation), **7918295320** (ME → Insurance), **7918324247** (Insurance
→ Welcome Call) — so an item created by this automation is shaped exactly like
one that took the long way round. Re-derive rather than trust this table if any
of those three has changed: `node scripts/cash-pay/deriveHopChain.mjs`.

⚠️ **Column ids differ across boards far more often than the titles do** — 9 of
the 38 below are renamed or re-typed on the way (Coverage Paths, both Deductible
and both OOP Max columns, Insurance Plan → Plan Name, Primary/Secondary
Insurance, Referral Subclass, Referral?, Stedi Coinsurance %, Stedi Home Plan,
Stedi Plan Begin Date, Stedi QMB?, Pt. Phone → Primary Phone). Matching on the
title alone gets those wrong, and a mis-mapped column is a permanently blank
field with nothing erroring (§5.11).

⚠️ **Four of them change TYPE** — Deductible, Deductible Remaining, OOP Max and
OOP Max Remaining are `numbers` on Profile Send Off and `text` on Welcome Call.
That is what the existing chain already does (§5.31g: the plain text pair is
what travels), so mirror it rather than "fixing" it.

| # | Profile Send Off (source) | Welcome Call (target) |
|---:|---|---|
| 1 | **Address** `location_mm1xhw17` | **Address** `location_mm1xhw17` |
| 2 | **CGM Coverage Path** `color_mm1w7e5q` | **CGM Coverage Path** `color_mm2wsam4` |
| 3 | **CGM Type** `color_mm1w7pmf` | **CGM Type** `color_mm1w7pmf` |
| 4 | **Clinic Address** `location_mm1xjnfv` | **Clinic Address** `location_mm1xjnfv` |
| 5 | **Clinic Name** `dropdown_mm1xbvas` | **Clinic Name** `dropdown_mm1xbvas` |
| 6 | **Clinicals Method** `color_mm1xw7y5` | **Clinicals Method** `color_mm1xw7y5` |
| 7 | **Date of Intake** `date_mm1wf43j` | **Date of Intake** `date_mm1wf43j` |
| 8 | **Deductible** `numeric_mm1ztdz4` | **Deductible** `text_mm1xkbqc` |
| 9 | **Deductible Remaining** `numeric_mm1zv64b` | **Deductible Remaining** `text_mm1xdzxw` |
| 10 | **DOB** `text_mm1xvxst` | **DOB** `text_mm1xvxst` |
| 11 | **Doctor Email** `email_mm1x6fq5` | **Doctor Email** `email_mm1x6fq5` |
| 12 | **Doctor Fax (@rcfax)** `email_mm1xdzcj` | **Doctor Fax (@rcfax)** `email_mm1xdzcj` |
| 13 | **Doctor Name** `text_mm1x46et` | **Doctor Name** `text_mm1x46et` |
| 14 | **Doctor NPI** `text_mm1x7d91` | **Doctor NPI** `text_mm1x7d91` |
| 15 | **Doctor Phone** `phone_mm1xz8c0` | **Doctor Phone** `phone_mm1xz8c0` |
| 16 | **Email** `text_mm1xc140` | **Email** `text_mm1xc140` |
| 17 | **Gender** `color_mm1x1bdg` | **Gender** `color_mm1x1bdg` |
| 18 | **Insulin Pump Coverage Path** `color_mm1w5xn1` | **Insulin Pump Coverage Path** `color_mm2xtn41` |
| 19 | **Insurance Plan** `dropdown_mm1y2x75` | **Plan Name** `dropdown_mm2wrzrk` |
| 20 | **Member ID 1** `text_mm1x2qk2` | **Member ID 1** `text_mm1x2qk2` |
| 21 | **Member ID 2** `text_mm1xaccx` | **Member ID 2** `text_mm1xaccx` |
| 22 | **OOP Max** `numeric_mm1zfv02` | **OOP Max** `text_mm1xdtj7` |
| 23 | **OOP Max Remaining** `numeric_mm1zxktp` | **OOP Max Remaining** `text_mm1xx5f` |
| 24 | **Primary Insurance** `color_mm1xg10n` | **Primary Insurance** `color_mm1x157j` |
| 25 | **Profile Send Off Notes** `text_mm389fs` | **Profile Send-Off Notes** `text_mm6vvsjy` |
| 26 | **Pt. Phone** `phone_mm1x44yk` | **Primary Phone** `phone_mm1x44yk` |
| 27 | **Pump Type** `color_mm1wjjtk` | **Pump Type** `color_mm1wjjtk` |
| 28 | **Referral Source** `color_mm1w5wxr` | **Referral Source** `color_mm1w5wxr` |
| 29 | **Referral Subclass** `color_mm7d71vd` | **Referral Subclass** `color_mm7d1rje` |
| 30 | **Referral Type** `color_mm1wm4n4` | **Referral Type** `color_mm1wm4n4` |
| 31 | **Referral?** `color_mm52kc3n` | **Referral?** `color_mm521sez` |
| 32 | **Request Type** `color_mm1w1978` | **Request Type** `color_mm1w1978` |
| 33 | **Secondary Insurance** `color_mm1zbrx0` | **Secondary Insurance** `color_mm241kqp` |
| 34 | **Serving** `color_mm1w1cm9` | **Serving** `color_mm1w1cm9` |
| 35 | **Stedi Coinsurance %** `text_mm1xssyw` | **Stedi Coinsurance %** `text_mm391jq8` |
| 36 | **Stedi Home Plan** `dropdown_mm457xy2` | **Stedi Home Plan** `dropdown_mm5ett1r` |
| 37 | **Stedi Plan Begin Date** `text_mm1xsa9` | **Stedi Plan Begin Date** `text_mm3gdksx` |
| 38 | **Stedi QMB?** `text_mm25zsdd` | **Stedi QMB** `text_mm2wms12` |

### One optional extra

The existing Insurance → Welcome Call hop also sets Welcome Call's section
divider **TIME IN PIPELINE --&gt;** `color_mm1w32e5` to the literal string
`"TIME IN PIPELINE -->"`. It is a CONSTANT, not a copy — it carries nothing
about the patient — so it is cosmetic. Set it for shape-parity if the divider
renders oddly without it; leaving it out breaks nothing.

### Deliberately NOT mapped

⚠️ **Profile Send-Off Notes (retired)** `long_text_mm5g1txs` on Welcome Call.
The live chain still writes it — 7918324247 carries three rows into retired
columns and §10 says to clear them — but a NEW automation must not start out
writing a column nothing reads. The live target is **`text_mm6vvsjy`**, which
row 25 above carries.

These 14 Profile Send Off columns reach Medical Evaluation and stop there, so
they do not reach Welcome Call today by any route and are not carried here
either:

- `file_mm1w5vwp`
- `text_mm1xyp9y`
- `text_mm1xpgy2`
- `text_mm1xehx8`
- `text_mm1xzqe0`
- `text_mm1xyga2`
- `text_mm1x7hkk`
- `text_mm1xyzqx`
- `text_mm1x32jw`
- `text_mm1xkdgq`
- `text_mm1xhymg`
- `text_mm1xdcet`
- `color_mm1yeksx`
- `text_mm3y53qn`

Most are the per-field Stedi readouts (In Network?, Copay, the four
Individual/Family deductible and OOP figures, Prior Auth Required?, Plan Name),
plus **Clinical Files** `file_mm1w5vwp`, **Run Stedi Eligibility**
`color_mm1yeksx` and **Prescriber Requirements** `text_mm3y53qn`. For a cash pay
patient nearly all of them are blank anyway — no eligibility check ran — so
carrying them would copy blanks. Adding any of them is a decision, and it should
be made for the insured chain at the same time or the two shapes diverge.

## After publishing

1. **Verify with one real item** before flipping anything: create a test item in
   Profile Clean-Up, set Move to Onboarding → "Advance to Welcome Call", and
   check the Welcome Call item carries all 38 values — not just that it appeared.
   A create-item step with a missing mapping still creates the item.
2. Flip **`CASH_PAY_SKIPS_TO_WELCOME_CALL`** to `true` in
   `src/lib/profile/cashPayIntake.ts`. `cashPayIntakeWiring.test.ts` pins it at
   false and will fail — that failure IS the checklist; update the test in the
   same commit.
3. ⚠️ Do this **off-hours**. These are live boards (the standing rule in §10).

## Re-deriving the table

`deriveHopChain.mjs` reads the three hop automations through the monday MCP
tools' saved output and re-computes the chain. It takes the directory holding
`list_automations` responses for boards 18406352652, 18406060017 and
18410601299 — it has no monday credentials of its own and never writes.
