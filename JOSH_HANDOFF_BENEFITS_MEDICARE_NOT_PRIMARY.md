# Benefits — Medicare not Primary + Failed-Check Escalation (for Josh)

Changes to `benefits-redesign.html` (UI-only prototype, updated 2026-07-20). The prototype is the
visual/behavioral spec; this doc covers the logic the backend needs. Everything else on the
Benefits page is unchanged from the previous handoff (`JOSH_HANDOFF_BENEFITS.md`).

---

## 1. Medicare A&B: third answer on Check 1 (In-Network)

**The old yield-sign bullets are GONE.** The HMO (Medicare Adv) / MSP (Secondary Payer) /
Inpatient (Hospital/SNF) note that sat next to the In-Network title is deleted — do not port it.

In its place, when the patient is **Medicare A&B only** (primary matches `Medicare A&B`, secondary
= None), Check 1 gets a **third answer**, rendered 3-across in one row:

> In-Network · Out-of-Network · **Medicare not Primary**

- Stored as its own value (`medicare-not-primary`) on the in-network check — it is NOT the same
  stored value as Out-of-Network, but it **behaves identically** everywhere downstream (§2–§4).
- Only rendered for Medicare A&B-only patients. If the primary/secondary changes so the patient is
  no longer Medicare A&B-only, a lingering "Medicare not Primary" answer is **cleared** (back to
  unanswered) — the prototype does this on payer change; the backend should never receive this
  value for a non-Medicare-A&B patient.
- The MAC **jurisdiction pill** in the step-1 header stays — only the bullets were removed.

## 2. Negative checks gate Step 2 off

A **negative** answer on any of the 3 universal checks is: Out-of-Network, **Medicare not
Primary**, Not Active, or Not Covered.

While any check is negative:

- **Step 2 (product cards + step-2 call log) is disabled** — grayed out, non-interactive. No Auth
  Requirements or SoS entry is collected.
- A rose banner shows above the (disabled) cards:
  > "**{failed check(s)}.** Submit below to escalate patient"
  (e.g. "**Out-of-Network.**", "**Medicare not Primary.**" — joined with " · " if several fail)

## 3. Submission opens up on a failed check

Normal path (all 3 affirmative): unchanged — every product needs Auth + SoS before the send button
enables.

Failed-check path: the send button **enables as soon as all 3 checks are answered** — product
fields are NOT required (they're disabled). The button relabels to **"Submit — Escalation
Required"** so the rep knows what they're sending.

**Validation rule for the backend:** if any universal check is negative → require only that all 3
checks have an answer; skip all per-product validation.

## 4. Writes on submit with a failed check

- **Escalation → "Escalation Required"** (this is the point of the flow).
- **Stage Advancer → "Benefits / SoS"** (stays at this stage — existing rule, unchanged).
- Active/Network → "Stuck" when In-Network or Active isn't confirmed ("Medicare not Primary"
  counts as not-confirmed here). DME Benefits → "Partial / No" when not confirmed.
- Auth / SoS / per-product auth result columns: **untouched/blank** — step 2 never ran.

Open question (flag for Brandon): both Out-of-Network and Medicare not Primary currently land on
the board identically (Stuck + Escalation Required). If ops needs to tell them apart on the board,
we need either a new column value or an auto-appended note — not built in the prototype.

## 5. Unchanged / reminders

- All-affirmative flow, SoS derivation, DVS routing, who-to-call pills, POS-11 flag: unchanged.
- Escalation from `pump not-clear` SoS still applies as before (independent of this change).
- Demo scaffolding to strip in production: scenario switcher bar, DEMO-tagged header dropdowns,
  Monday Board Output drawer.

## 6. Quick test checklist

1. Medicare A&B scenario → Check 1 shows 3 buttons in one row; other payers show 2.
2. Select "Medicare not Primary" → step 2 grays out, banner shows, send button enables once
   Active + DME are answered; submit → Escalation Required, stage stays Benefits / SoS.
3. Same behavior with Out-of-Network on any payer; same with Not Active / Not Covered.
4. Switch primary from Medicare A&B while "Medicare not Primary" is selected → answer resets.
5. All 3 affirmative → old behavior exactly (products required before send, no escalation).
