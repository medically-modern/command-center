# Submit Auth Redesign — Backend Handoff Notes (for Josh)

Working notes collected while designing `submit-auth-redesign.html` (UI-only prototype, July 2026).
The prototype is the visual/behavioral spec; this doc covers what the backend needs to do differently
from the current live Submit Auth tab. Logic mirrors `SubmitAuthPage.tsx` + `AuthorizationsPanel.tsx`
+ the `submitAuth` branch of `lib/samantha/mondayWrite.ts` unless noted. Companion doc:
`HANDOFF-Josh-Auth-Outstanding.md` (the next stage).

---

## 1. One step, context up top

The page is a single step — "**(1) Submit Auth for Each Required Product**" — one card per product
whose board auth status is **Required** and that is **not DVS-routed** (§6). Above it, the
"Auth Status by Product" matrix is **read-only context**, not a step.

Matrix color semantics (deliberate, from Brandon — matches Auth Outstanding): **Required = amber**
(today's work), **No Auth Needed / resolved = grayed out** (no action), Not Serving = faded,
DVS Required = blue. No green/mint emphasis on no-action cells.

## 2. Submission card fields

Per product: **Method** (Availity Portal / Payer Portal / Call / Fax — segmented, required);
**Call/Fax number** (required only when method is Call or Fax); **Auth Submission Date** (required);
**Auth ID** (optional — payer may not have issued one yet). Horizon BCBS + Payer Portal reveals the
shared **Carecentrix Intake ID** (ONE per patient — same value writes for every product).

## 3. SoS: nothing on this page

Same-or-Similar lives at Benefits; the recheck happens at Auth Outstanding. No SoS fields, columns,
or language anywhere on Submit Auth.

## 4. Modifiers on the card headline

Each card headline is `HCPC · [mod][mod]` (gray mono chips, no label). Source of truth =
`claims-ui-tool` repo tables: defaults KX/NU; Anthem NY 803 route (KX supplies, A4239 = KF+KX+CG);
CareCentrix 11348 (NU+SC supplies, NU pump/monitor); BCBS TN direct (NU). Modifiers follow the
**billing payer**, never the referral source. The prototype keys routes off the payer name as a
simplification — **the real route is by patient address state** (e.g. NJ → CareCentrix 11348),
same resolution the claims board uses.

Carecentrix referrals get a one-line amber banner pointing at the per-card modifiers.

## 5. MLTC banner (UPDATED 2026-07-20 — definitive, from the Stedi Plan Name column)

**Trigger:** the **"Stedi Plan Name" column contains "MLTC"** (case-insensitive). That's the whole
rule. The old heuristic (Anthem Low-Cost JLJ + Medicaid ID present) is **deleted** — real MLTC 271s
return NO Medicaid CIN anywhere, so that heuristic only fired if the rep happened to key Member ID 2
from the card.

Verified against two real Anthem MLTC 271s run through `parse_eligibility_response` (2026-07-20):

- The plan label **"NEW YORK MLTC" already lands in Stedi Plan Name today**, via
  `benefitsInformation[0].planCoverage` (`EB*1**30*MC*NEW YORK MLTC`) — pass 2 of
  `_parse_plan_name()`. No parser change needed for Anthem-shaped responses.
- The same string also sits in `planInformation.planDescription` (REF*18), which the parser never
  reads. Harmless duplicate for Anthem — but a payer that puts the plan label ONLY there would
  leave the column untouched. **Robustness ask: add `planInformation.planDescription` as a later
  pass of `_parse_plan_name()`.**
- Do **NOT** key MLTC off "Stedi Managed Medicaid" — these 271s leave it blank
  (`_parse_managed_medicaid_carrier` only fires on code-"U" referral rows; MLTC comes back as
  active coverage code 1 directly). Plan name is the reliable signal of the two.

**Behavior:** amber banner above the cards:
> *"MLTC plan — {Stedi Plan Name} on the Stedi check — all auths submitted via **fax** only."*

No "Likely" — the column is the source of truth. Still a tip only: do NOT force or preselect the
Fax method, and don't gate on it. (Routing side unchanged: MLTC plans land at Anthem BCBS
Low-Cost (JLJ); supplies are authed through Anthem, not routed to NY Medicaid.)

## 6. DVS routing — which products get NO submission card

- **Managed Medicaid** (Fidelis Medicaid / Anthem JLJ Medicaid with NY Medicaid secondary):
  **supplies** (infusion sets, cartridges) route to NY Medicaid → no card; handled at the DVS stage.
- **Straight `Medicaid` primary: EVERYTHING bills to Medicaid — pump included.** All products
  DVS-routed, zero submission cards. *(The live backend does not have the straight-Medicaid-pump
  rule yet — this is a deliberate change.)*
- DVS-routed products show a blue note: "<Products> bill to NY Medicaid. Submit DVS at the next
  stage once the pump is approved." (or "…at the DVS stage — nothing to submit here.")

## 7. Writes on "Auth Submission Complete"

- **Stage Advancer → "Auth Outstanding"** (always, when cards exist and validate).
  *Open question: a straight-Medicaid patient with zero cards should probably advance to the DVS
  stage instead — confirm with Brandon before wiring.*
- **Follow Up Date (`date_mm34m2dz`) → TODAY** (NEW 2026-07-20). Same-day, not +1, because many
  auths are approved right away. Context: Auth Outstanding is becoming a daily bucket — the rep
  will only be shown patients whose Follow Up Date is **today or earlier**, and a "Still
  Outstanding" button will push the date +1 day so they can clear their bucket each day. (The
  bucket + button ship with the Auth Outstanding batch; this write is the prerequisite.)
- Per submitted product: auth result column → **"Submitted"**, plus method, submission date,
  Auth ID (if entered), Call/Fax number (single shared column, as today), shared Intake ID.
- Escalation: manual Escalate button only on this page (no auto rules here).
- Gating (client + server): every card has method + date (+ number when Call/Fax).

## 8. Header + home-plan banner

Header is read-only in production, fed by Profile Send-Off (demo dropdowns are testing-only — strip).
BCBS-family with home plan ≠ host plan: Stedi Home Plan box gets a "HANDLES AUTHS" tag and the step
shows "Auths go through the member's home plan — {home} {phone} — not {host}, the host plan we bill."
Home plan from the 271 (`_parse_home_plan` canonical names). Phone numbers come from a demo
directory in the prototype — production needs the real payer-phone source (Janelle/Sam's directory
effort, likely a Monday board).

## 9. Demo scaffolding — strip before production

- Serving / Primary / Secondary header dropdowns (DEMO-tagged).
- Demo scenario switcher bar (5 scenarios incl. "Anthem MLTC · Pump" for §5).
- **Monday Board Output drawer** — keep while implementing to verify writes, then delete.
  (On this page the action buttons still sit inside/below it — when you delete the drawer, keep the
  Escalate + Auth Submission Complete buttons; see the Auth Outstanding prototype for the
  separate-actions-card pattern.)

## 10. Removed from Submit Auth (do not port)

- Call-log rows, Trigger DVS button, who-to-call pill, step subtitles.
- All SoS UI (§3).
