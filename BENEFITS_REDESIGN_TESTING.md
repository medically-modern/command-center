# Benefits Redesign — What Changed & How to Test It

Written for Josh, 2026-07-16. Companion to `BENEFITS_REDESIGN_REVIEW.md` (the full
decision log) and `JOSH_HANDOFF_BENEFITS.md` (Brandon's spec).

---

## 1. Old vs. New — the whole change in one table

| | **Old Benefits tab** | **New Benefits tab** |
|---|---|---|
| **Same-or-Similar** | Rep picked **Clear / Not Clear / Skip** from a dropdown per product, using the lookback hint as guidance. | Rep records **facts**: Last Bill Date + Units, or "No Billing History". Clear/Not-Clear is **computed** from the date vs. the lookback window. The rep never sees or picks it. |
| **Skip** | Auto-selected when Auth = Required, but the rep could override it. | **Derived, not overridable**: Auth = Required always means Skip (SoS deferred until the auth resolves; the entry section grays out). |
| **Lookback windows** | 4 yr pump/monitor, 90 d everything else (hint text only). | Same 4 yr / 90 d, **plus a 60-day window for sensors & supplies when the patient has Medicaid** (primary or secondary). And the window now *decides* the outcome. |
| **Last Bill Date** | Entered only when the rep picked Not Clear. | Entered for **every billed product**, with **Units** (new). |
| **Medicare never-billed** | Two attestation checkboxes (E0784/A4224/A4225 and A4239/A4238/E2103). | **Derived** from the per-product "No Billing History" entries. IS + Cartridges both never-billed on Medicare A&B also writes the literal **"TBD"** to the new Medicare Prior Pump Date column (Welcome Call fills the real date later). |
| **Universal checks** | Dropdowns: Confirmed / Not Confirmed. | Buttons: **In-Network/Out-of-Network · Active/Not Active · Covered/Not Covered**. Same two Monday columns, same labels. |
| **Escalation** | Rep clicked Escalate and filled a reason form (plus auto-escalation on send for blockers). | **Derived only**: any failed universal check OR pump Not-Clear escalates on send. The reason line is **auto-composed** and appended to Call Reference Notes. No button, no form. |
| **Follow Up** | Header button parked the patient. | **Removed** at Benefits (Submit Auth / Auth Outstanding keep theirs; existing follow-ups still clear from the sidebar). |
| **Trigger DVS** | Two buttons for Medicaid patients. | **Removed** (D3) — DVS gets its own stage; manual Monday handling until then. |
| **Header** | Most fields editable (pencil toggle; secondary insurance always editable). | **Read-only.** Profile Send-Off must finalize everything. Bad data = fix at Profile, not here. |
| **Call logs** | None (just the shared notes box). | **Two append-only call logs** — payer calls (Step 1) and SoS/auth calls (Step 2) — each row lands as one timestamped line in its own Monday column, history never overwritten. |
| **Notes** | Append-style Reference Notes panel. | Same panel, now in the right rail. |
| **Where writes go** | Same board columns. | **Same columns, same labels** — plus 13 new ones (10 SoS facts, 2 call logs, 1 pump date). The stage/escalation/dropdown writes are byte-identical to before, just fed by derived values. |

**The one-sentence version:** the rep used to record *conclusions* (Clear/Not Clear);
now they record *evidence* (dates, units, never-billed) and the app draws the
conclusions — identically every time.

## 2. What did NOT change (safe to rely on)

- The verified-write send: data columns first, verification, **Stage Advancer last**.
- Every existing column id, status label, and index. Downstream (Submit Auth, Auth
  Outstanding, sosRecheck, oversight, counts, baselines) reads the same values.
- The legacy Last Bill Date columns still mean "Not Clear" by presence — Final
  Confirm and Welcome Call behave exactly as before (D2).
- Stage rules: all clear → Complete; any auth required → Submit Auth.; blocker or
  incomplete → stays Benefits / SoS. Escalated patients still move to the
  Escalations group via the board automation.

## 3. How to test — the demo scenario tabs

The tabs above the page (from Brandon's prototype) build a local **Bob Jones
[TEST]** patient per situation. **Demo patients never write to Monday** — the send
button just confirms. Use them with the **Monday Board Output drawer** (bottom
card): it shows exactly what each column write WOULD be, computed by the same
engine the real send uses.

For every scenario: answer the three checks, fill each product, open the drawer,
compare against the expectations below.

### Tab 1 — Commercial · IP + CGM (Horizon BCBS)
The baseline. 5 products visible. Try:
- Sensors billed **~2 months ago** → SoS shows **Partial / Not Clear**? No — sensors
  aren't the pump, so: Not Clear Products = "CGM Sensors", **Escalation = Done**,
  and with no auths → **Stage = Complete**. (Non-pump Not-Clear never escalates.)
- Pump billed **within 4 years** → Escalation = **Escalation Required**, Stage stays
  **Benefits / SoS**.
- Pump billed **>4 years ago** → pump Clear, IP Next Order Date = bill + 4 yr.
- Any product Auth = **Required** → its entry grays out ("Deferred until the auth is
  resolved"), it appears in **Skip SoS Products**, Stage = **Submit Auth.**, and its
  entered date stops feeding Next Order Dates.

### Tab 2 — Medicare A&B
The never-billed/TBD path:
- Mark **Infusion Sets AND Cartridges = No Billing History** → drawer shows
  **Never billed IS/Car = Never Billed** and **Medicare Prior Pump Date = TBD**.
- Mark **CGM Sensors = No Billing History** → **Never billed CGM = Never Billed**.
- Un-mark one of IS/Cartridges → both rows disappear (needs BOTH).

### Tab 3 — Managed Medicaid · Pump (Fidelis Medicaid + NY Medicaid)
The Medicaid special cases:
- Only the **pump** card is visible; the banner says Infusion Sets & Cartridges are
  handled at the DVS stage. The drawer still shows their auth results = **Required**
  (the DVS automation keys on that) and **Auth = Auths Required** → Stage can never
  be Complete here, always **Submit Auth.**
- Pump Auth = Required → pump lands in **Skip SoS Products** (this is the
  intentional Clear→Skip change, D5 — it will resurface in the Auth Outstanding
  recheck).
- Sensors/supplies lookback (visible on other tabs with a Medicaid secondary):
  **60 days** instead of 90 — a bill 86 days old is Clear with Medicaid, Not Clear
  without.

### Tabs 4–5 — BlueCard · CT Home Plan / Out-of-State · POS 11
Standard commercial derivations (same as Tab 1). Their *special* behavior — the
who-to-call pills and the "probably out of network / POS 11" flag — is **not built
yet**: it's blocked on the Anthem rulebook (D7), which doesn't exist. The tabs are
here so the flows are ready to verify the moment that ships.

## 4. How to test — one real patient, end to end

1. Pick (or create) a throwaway patient on the Insurance board's Benefits group.
2. Work the page: 3 checks, per-product auth + facts, a call-log row in each log,
   a note in Reference Notes.
3. Open the drawer, screenshot it. Click **Benefit Check Complete**.
4. On the Monday board, check the item against the screenshot:
   - the aggregates, dropdowns, escalation, and stage columns should match the
     drawer exactly, row for row;
   - **SoS Last Bill / SoS Units** (new columns) hold each billed product's facts;
   - the **legacy** Last Bill Date columns hold dates ONLY for Not-Clear products;
   - **Benefits Call Log / SoS / Auth Call Log** gained one line per row you added
     (send again with a new row — the old line must still be there);
   - if you forced an escalation, **Call Reference Notes** gained the
     `[Auto-escalated · …]` line and the item moved to the Escalations group.
5. Watch the automation move the item (Complete → Welcome Call item created;
   Submit Auth. → Submit Auth group).

## 5. Things that will look "off" but are correct

- **Universal checks are blank after a reload** — they were never readable on the
  Benefits group (pre-existing); use header **Save** to keep work-in-progress.
- **A patient with bad header data can't be fixed here** — read-only by design;
  fix at Profile Send-Off.
- **Demo tabs + Board Output drawer are testing aids** — both get deleted for
  production (spec §6/§8).

## 6. Prerequisite for full end-to-end flow

The new columns reach the **Welcome Call board** only after the automation mapping
session (automation `7918324247`) — **16 required mappings**, all same-named pairs:
pump date `text_mm59qh8r` → `text_mm58k9x9`, the 10 SoS Last Bill / SoS Units pairs,
and the 5 SoS No Billing History checkboxes. The two call logs deliberately do NOT
travel — call history stays on the Insurance board. Until the mappings are added the
data is correct on the Insurance board but doesn't travel.
