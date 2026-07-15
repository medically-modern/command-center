# Benefits Tab Redesign — Backend Handoff Notes (for Josh)

Working notes collected while designing `benefits-redesign.html` (UI-only prototype, July 2026).
The prototype is the visual/behavioral spec; this doc covers what the backend needs to do differently
from the current live Benefits tab. Line references are to the prototype's logic, which mirrors
`src/lib/samantha/*` unless noted.

---

## 1. Same-or-Similar is now DERIVED — the rep never picks Clear / Not Clear

The rep records **facts** per product (per HCPC):

- **Last Bill Date** + **Units**, OR
- **No Billing History** (nothing on file at the payer — the "never billed" state)

**Skip is NOT a UI control** — the rep never sees or selects it. When **Auth = Required**, the entire
Same-or-Similar section grays out (disabled) and SoS is derived as **Skip** (defer until the auth resolves),
exactly the state today's auto-skip produced. Any previously entered date/units are ignored while Auth =
Required. Skip must still flow to the board (Skip SoS Products column, sosRecheck on Auth Outstanding)
unchanged.

Backend derives the SoS status:

| Entry | Derived SoS |
|---|---|
| No Billing History | **Clear** (plus never-billed handling below) |
| Date older than the product's lookback | **Clear** |
| Date within the lookback window | **Not Clear** |
| Auth = Required (SoS section disabled) | **Skip** (derived, never rep-selected) |

**Lookback windows (per product):** Insulin Pump (E0784) and CGM Monitor (E2103) = **4 years**;
CGM Sensors / Infusion Sets / Cartridges = **90 days**, or **60 days** when the patient has Medicaid
(primary or secondary). *(Note: current live code uses flat 90 days for everything — the 4-yr/Medicaid-60
tiers are a deliberate change from Brandon.)*

- **Units: add a Units column to the Welcome Call board** and write the entered units there alongside the last bill date.
- Next Order Dates keep the existing math, driven off the entered Last Bill Date:
  pump +4 yr, sensors +90 d, supplies max(IS, cartridges) +90 d (60 d Medicaid).
- Existing Monday columns (SoS, Not Clear Products, Skip SoS Products) are written from the **derived** values —
  same labels as today.

## 2. Never Billed replaces the Medicare A&B attestation checkboxes

The old "E0784/A4224/A4225 never billed" and "A4239/A4238/E2103 never billed" checkboxes are gone.
Derive them from the per-product Never Billed entries:

- Medicare A&B + Infusion Sets **and** Cartridges = Never Billed → write **Never billed IS/Car = "Never Billed"**,
  and write the literal string **"TBD"** to the pump-date text column **`text_mm58k9x9`**
  (a later flow — welcome call — replaces TBD with the approximate date the patient got their pump; that flow
  also handles "order a monitor" when CGM history is blank. Nothing else to do at Benefits.)
- Medicare A&B + CGM Sensors = Never Billed → write **Never billed CGM = "Never Billed"**.

## 3. Universal checks — relabeled, same columns

Buttons are now **In-Network / Out-of-Network**, **Active / Not Active**, **Covered / Not Covered**.
They map to the same underlying pass/fail statuses and Monday columns as today's Confirmed / Not Confirmed
(Active/Network → "Active/In-network" vs "Stuck"; DME Benefits → "Yes" vs "Partial / No").

## 4. Call logs (two of them) — append onto the existing notes columns

Two call-log sections, each a list of rows of **[Reference #] [Call notes]** with an "+ Add Call" button:

- **Section 1** (under the universal checks): defaults to ONE visible empty row; rep can add more.
- **Section 2** (under the SoS/auth product cards): defaults to ZERO rows; first row is added on demand.

Backend: no new storage needed — on send, **append** each row onto the existing notes column(s)
(same pattern as the current Call Reference Notes / `COL.callReferenceNotes`), e.g. one line per call:
`[Benefits call · ref 4821-A · 2026-07-13] <notes>` and tag section-2 entries as SoS/auth calls.
Rows are append-only history; don't overwrite prior sends.

## 5. Submit / advancement rules

On **Benefit Check Complete** (the old Send to Monday):

- If the 3 universal checks are **not 3/3 pass** → **Escalate** (Escalation = "Escalation Required", Stage Advancer stays "Benefits / SoS").
- OR if the **pump's derived SoS = Not Clear** (last bill within 4 years) → **Escalate**.
- **All other cases advance**: any auth required → Authorization; otherwise → Complete
  (existing Stage Advancer logic unchanged; other products being Not Clear do NOT escalate — matches current behavior).

Gating (client + server): all 3 universal checks answered; every visible product has Auth answered AND
a complete SoS entry (date+units, Never Billed, or Skip).

## 6. Header is read-only, fed by Profile Send-Off

- **Serving, Primary Insurance, and Secondary Insurance are READ-ONLY** at Benefits — along with
  Member ID 1/2 and everything else in the header. No edit mode, no edit toggle. Profile Send-Off must
  finalize all of it (including secondary insurance and the Medicaid ID) before the patient reaches Benefits.
  The dropdowns you'll see in the prototype are tagged "DEMO" and exist ONLY so different payer/serving
  combos can be tested — strip them in the production build.
- Header displays the full Stedi output (from the Profile Send-Off check): Active, Payer Name, Plan Begin,
  Coverage Type, Plan Name, Home Plan, Medicaid ID, QMB, cost sharing (individual/family).
  **Payer-aware display:** QMB only for Medicare, Medicaid ID only when Medicaid involved, Home Plan only for BCBS family.

## 7. BCBS/Anthem who-to-call pills + POS/out-of-network warning

- For BCBS-family primaries only: suggestion pills — universal checks: In-Network → the plan we bill;
  Active + DME → the member's **home plan** (271 NM1\*VER, use `_parse_home_plan` canonical names, not string matching).
  Step 2: Auth → home plan; SoS → billed plan. Collapses to one payer when home = billed.
- POS rule (from ANTHEM_BCBS_PRIMARY_SUGGESTION_RULEBOOK): address state ∈ {NY, NJ, TN, FL, WY} → POS 12 (Home);
  any other state → "probably out of network" warning: bill through Anthem NY (803) BlueCard, POS 11 (Office).
- Future: payer phone directory (plan → provider-services number), likely a Monday board; Janelle/Sam are
  collecting numbers now.

## 8. Removed from Benefits (do not port)

- Trigger DVS button — DVS moves to its own stage (separate handoff to come; supplies-only and
  straight-Medicaid patients skip Benefits entirely and enter at the DVS stage; Medicaid-billed supplies are
  hidden at Benefits with a "handled at the DVS stage" banner).
- Follow Up button, Escalate button (escalation is derived, per §5), and the "edits stay local" info strip.
- **Monday Board Output drawer: remove before production.** It's a testing aid that shows exactly what each
  column write should be — feel free to KEEP it during implementation to verify your writes match the
  prototype's derivations, then delete it when this ships.
- Product billing-note text, universal-check hints, and all Clear/Not-Clear language in the rep-facing UI.
