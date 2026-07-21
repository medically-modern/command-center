# Monday.com Integration Spec — Samantha Checklist

## Board Info
- **Board ID:** `18410601299`
- **Board Name:** Insurance Onboarding
- **View ID:** `253804652`
- **API Token:** (stored as env var `VITE_MONDAY_API_TOKEN`)

## Groups (workflow stages)
| Group ID | Title |
|----------|-------|
| `group_mm1xr3q3` | Benefits |
| `group_mm1x1416` | Submit Auth |
| `group_mm2v6d1z` | Auth Outstanding |
| `group_mm2vg9gn` | Escalations |
| `group_mm2vw3c0` | Complete / Stuck |

---

## READ from Monday → Populate the UI

| UI Field | Monday Column | Column ID | Type |
|----------|--------------|-----------|------|
| Patient Name | Name | `name` | name (item name) |
| Product/Serving | Serving | `color_mm1w1cm9` | status |
| Primary Insurance | Primary Insurance | `color_mm1x157j` | status |
| Doctor Name | Doctor Name | `text_mm1x46et` | text |
| Clinic Name | Clinic Name | `dropdown_mm1xbvas` | dropdown |
| DOB | DOB | `text_mm1xvxst` | text |

---

## WRITE back to Monday → Main Columns (universal checks)

These map to the 4 universal checks in the UI:

| UI Check | Monday Column | Column ID | Status Values |
|----------|--------------|-----------|---------------|
| ✓ In-Network + Active | Active/Network | `color_mm2vhwan` | `1` = "Active/In-network", `2` = "Stuck" |
| ✓ DME Benefits Confirmed | DME Benefits | `color_mm2vt8xg` | `1` = "Yes", `2` = "Partial / No" |
| ✓ Same or Similar Clear | SoS | `color_mm2vemyy` | `1` = "All Clear", `2` = "Partial / Not Clear" |
| ✓ Auth Required? | Auth | `color_mm2vg3ew` | `0` = "Auths Required", `1` = "No Auths Required" |

### Write-back logic:
- Check ✓ (checked) → write the "pass" index (1, 1, 1, 1 respectively)
- Check ✗ (unchecked or failed) → write the "fail" index (2, 2, 2, 0 respectively)

---

## WRITE back to Monday → Product-Specific Auth Results

Each product has its own auth result column. The status options are identical across all:

| Index | Label |
|-------|-------|
| `0` | Evaluate |
| `1` | Auth Valid |
| `2` | Denied |
| `3` | No Auth Needed |
| `4` | Submitted |
| `6` | Required |
| `7` | Not Serving |

| Product | Monday Column | Column ID |
|---------|--------------|-----------|
| CGM (Monitor) | CGM Auth Result | `color_mm1wgjd1` |
| Sensors | Sensors Auth Result | `color_mm1x5c99` |
| Insulin Pump | IP Auth Result | `color_mm1xnzmn` |
| Infusion Sets | Infusion Set Auth Result | `color_mm1xr2j1` |
| Cartridges | Cartridge Auth Result | `color_mm1xybvt` |

### Write-back logic:
- The UI product code dropdown maps to these statuses:
  - "Approved" → `1` (Auth Valid)
  - "Denied" → `2` (Denied)
  - "PA Required" → `6` (Required)
  - "Pending" → `0` (Evaluate)
  - Products not being served → `7` (Not Serving)

---

## Additional Auth Detail Columns (per product)

Each product also has Auth ID, Auth Start, and Auth End date fields:

| Product | Auth ID | Auth Start | Auth End |
|---------|---------|------------|----------|
| CGM | `text_mm1w1d5p` | `date_mm1wj1bz` | `date_mm1whebp` |
| Sensors | `text_mm1x8tdp` | `date_mm1x929` | `date_mm1xvnqb` |
| Insulin Pump | `text_mm1xmj8x` | `date_mm1xxbkz` | `date_mm1x2q3` |
| Infusion Sets | `text_mm1xf6ht` | `date_mm1xrk1c` | `date_mm1xj3wp` |
| Cartridges | `text_mm1xs6s8` | `date_mm1xp0vm` | `date_mm1xznf9` |

## Days Auth Outstanding (added 2026-07-21)

| Column | ID | Type | Semantics |
|--------|----|------|-----------|
| Days Auth Outstanding | `numeric_mm5f5ars` | numbers | Days since the **earliest** per-product Auth Submission Date. |

**Owned by the backend, read-only in the SPA.** The `baseline-cron` Railway
service recalculates it daily (9 AM ET weekdays) for every item in the Auth
Outstanding group — an idempotent `today − earliest submission date`, never an
increment, writing only when the value changed. Monday has no native
"increment a number daily" automation, which is why a cron owns this column.
The SPA prefers a live computation from the per-product submission dates and
uses the column as fallback (`src/lib/samantha/authOutstandingDays.ts` — the
counting contract twin of the cron's `recalcDaysAuthOutstanding`). Exists as a
real column (not a frontend derivation) so it can drive board filters and
future automations, e.g. "When Days Auth Outstanding changes, and only if it
is > 14, set Escalation to Escalation Required".

## Per-product partial save — "Save No Auth Needed" (added 2026-07-21)

Auth Outstanding's product cards have a **Save No Auth Needed** button
(visible when the card's Auth Result is No Auth Needed). It writes exactly one
product to Monday immediately — auth result → `No Auth Needed` (index 3) plus
a wipe of that product's Auth ID / Start / End / Units — through the verified
write protocol with an **empty stage list**: Stage Advancer and Escalation are
never touched, so no board automation fires and the patient stays in Auth
Outstanding. `saveNoAuthNeededToMonday` in `src/lib/samantha/mondayWrite.ts`.
The page-level **Send to Monday** remains the only stage-mover.

---

## API Examples

### Read items from Benefits group:
```graphql
{
  boards(ids: 18410601299) {
    items_page(limit: 50, query_params: { rules: [{ column_id: "group", compare_value: ["group_mm1xr3q3"] }] }) {
      items {
        id
        name
        column_values(ids: ["color_mm1w1cm9", "color_mm1x157j", "text_mm1x46et", "dropdown_mm1xbvas", "text_mm1xvxst", "color_mm2vhwan", "color_mm2vt8xg", "color_mm2vemyy", "color_mm2vg3ew", "color_mm1wgjd1", "color_mm1x5c99", "color_mm1xnzmn", "color_mm1xr2j1", "color_mm1xybvt"]) {
          id
          text
          value
        }
      }
    }
  }
}
```

### Write status back to Monday:
```graphql
mutation {
  change_simple_column_value(
    board_id: 18410601299,
    item_id: ITEM_ID,
    column_id: "color_mm2vhwan",
    value: "Active/In-network"
  ) {
    id
  }
}
```

Or using the label index approach:
```graphql
mutation {
  change_column_value(
    board_id: 18410601299,
    item_id: ITEM_ID,
    column_id: "color_mm2vhwan",
    value: "{\"index\": 1}"
  ) {
    id
  }
}
```

---

## Architecture Notes

- **Token handling:** Store the Monday API token as `VITE_MONDAY_API_TOKEN` env var in the Lovable project. It gets baked into the bundle at build time. Acceptable for internal tool.
- **CORS:** Monday.com API supports CORS — client-side calls from the browser work fine.
- **Filtering:** The app should show patients from the "Benefits" group (`group_mm1xr3q3`) since that's Samantha's stage.
- **Sync direction:** Read on page load + poll every 60s. Write on every user action (checkbox toggle, dropdown change) with debounce.

---

## Send Request → Supermail (Medical Evaluation board)

> **Note:** This flow lives on a *different* board than the rest of this spec —
> the **Medical Evaluation** board (`18406060017`), not Insurance Onboarding
> (`18410601299`). Added June 2026 with the Send Request redesign (commit `6568591`).

### How a request is sent
The app does **not** send mail itself. On Send / Re-send it writes three columns,
then a board-side **Supermail** automation (CarbonWeb marketplace app, "SuperMail –
Email Automation") does the dispatch:

| Step | Monday Column | Column ID | Type | Written |
|------|---------------|-----------|------|---------|
| 1 | Request Message | `long_text_mm4cnw52` | long_text | the approved fax/email body |
| 2 | Request Sent At | `date_mm2yg8x8` | date | timestamp (date + time) |
| 3 | Send Request (trigger) | `color_mm2y7t2x` | status | set to `Send` — **fires Supermail** |

**Ordering matters:** the body + timestamp are written **before** the trigger is
flipped, so Supermail never reads a stale/empty Request Message. Send is gated on
the MN Request Letter file (`file_mm2yydbc`) existing on the item.

### Fax vs Email
- **Email** method → Supermail emails the doctor (`email_mm1x6fq5`).
- **Fax** method → Supermail emails the **Doctor Fax (@rcfax)** address
  (`email_mm1xdzcj`, e.g. `<number>@rcfax.com`); **RingCentral** email-to-fax converts
  it to a fax. (RingCentral is otherwise only read for the unread-fax dashboard count.)

### REQUIRED Supermail config (backend to-do — not done by code)
Point Supermail's email **body** at the **Request Message** column (`long_text_mm4cnw52`)
so it sends the rep-approved wording. **Today Supermail builds its own body**, so until
this is wired the column is written but unused. Configure via the board's Automations /
Workflow Center or the Supermail app panel: replace the static body with the dynamic
value of `long_text_mm4cnw52`, leaving the attachment mapping unchanged.

### New read columns (June 2026, Send Request UI)
| UI Field | Monday Column | Column ID | Type | Direction |
|----------|---------------|-----------|------|-----------|
| Prescriber Requirements (amber note) | Prescriber Requirements | `text_mm4b45rh` | text | read-only |
| Patient Email (Patient Outreach card) | Email | `text_mm1xc140` | text | read |
| Request Message (editable body) | Request Message | `long_text_mm4cnw52` | long_text | read + write |

### Testing the fax path
Use a throwaway item (Clinicals Method = Fax, Doctor Fax set to a number you control,
MN Request Letter attached, Request Message populated). Flip Send Request → `Send`
manually first (isolates the automation), then via the UI Send button (end-to-end).
Verify: Supermail send log fired → RingCentral outbound Fax log shows "Sent" → recipient
receives the fax with the Request Message body + attachments → Request Sent At stamped.

**Status:** UI + column writes deployed (commit `6568591`, 2026-06-17). Supermail
body-mapping wiring **pending**.
