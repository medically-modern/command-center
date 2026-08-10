# Insurance label audit — six boards, five code tables, one routing table

Current as of **2026-08-10**. Every board fact below was read from the live
`settings_str` via the Monday API on that date, and every code fact from the files
named — **nothing here is from memory**. Regenerate before trusting it: the boards
drift on their own.

Scope: the **Primary Insurance**, **Secondary Insurance** and **General Insurance**
status columns, everywhere they exist, plus every place the SPA, the Cardinal
ordering service, or a Monday automation reads them.

> **Why this file exists.** Josh asked whether adding one new in-network payer is
> supported. The answer is that a payer label is not one fact in one place — it is
> **six board label sets, five hardcoded SPA tables, and one Cardinal routing table**,
> none of which validate against each other. This is the inventory of where they
> currently disagree.

---

## 0. The one-paragraph version

A payer is identified by a **status label string**, but written by **numeric index**,
and every board numbers its own labels independently. `Fidelis Medicare` is index
**7** on one board, **102** on another, **108** on two more, **110** on a fifth and
**151** on the sixth. Monday copies these between boards by matching the label
**text**, and when the destination has no identical label it writes a **blank and
does not error**. The SPA reads them back by matching the label text too, and when
*it* has no match it yields `""` and silently degrades. Nothing in this chain fails
loudly. Today there are **6 copy gaps**, **1 duplicate-payer pair**, **2 non-payer
labels sitting in a billing column**, and **at least one payer whose orders cannot
reach Cardinal at all**.

---

## 1. The six Primary Insurance columns

| Board | Board ID | Column | Labels |
|---|---|---|---|
| Profile Send Off | `18406352652` | `color_mm1xg10n` | 29 |
| Medical Evaluation (Masheke) | `18406060017` | `color_mm1x157j` | 28 |
| Insurance (Samantha) | `18410601299` | `color_mm1x157j` | 28 |
| Welcome Call | `18410804557` | `color_mm1x157j` | 28 |
| Subscription Board - Updated | `18407459988` | `color_mm254qxj` | 25 |
| New Order Board (No sub-items) | `18405457690` | `color_mm18jhq5` | 31 |

Insurance and Welcome Call share both the column ID **and** the exact label set.
Masheke shares the column ID but **not** the label set — it puts `Fidelis Medicare`
at **7** where the other two use **108**.

### 1.1 The index matrix

`—` = the label does not exist on that board. The last column counts how many
**different** indexes one payer occupies across the boards that have it.

| Label | Profile | Masheke | Insurance | Welcome Call | Subscription | Order | distinct |
|---|---|---|---|---|---|---|---|
| Aetna Commercial | 8 | 13 | 13 | 13 | 13 | 10 | 3 |
| CDPHP (capital district physicans' healthcare network) | — | — | — | — | 107 | 153 | 2 |
| Aetna Medicare | 9 | 14 | 14 | 14 | 14 | 11 | 3 |
| Anthem BCBS Commercial | 105 | 105 | 105 | 105 | 1 | 3 | 3 |
| Anthem BCBS Low-Cost (JLJ) | 108 | 109 | 109 | 109 | 9 | 109 | 3 |
| Anthem BCBS Medicaid (JLJ) | 103 | 104 | 104 | 104 | 8 | 0 | 4 |
| Anthem BCBS Medicare | 106 | 106 | 106 | 106 | 17 | 107 | 3 |
| BCBS FL | 17 | 1 | 1 | 1 | **—** | 13 | 3 |
| BCBS TN | 16 | 0 | 0 | 0 | 105 | 12 | 4 |
| BCBS WY | 18 | 2 | 2 | 2 | **—** | 103 | 3 |
| **BCBS Wyoming** | — | — | — | — | 19 | 104 | 2 |
| **CASH** | — | — | — | — | — | 152 | 1 |
| Cigna | 12 | 17 | 17 | 17 | 2 | 16 | 4 |
| Fidelis CHP | — | 110 | 110 | 110 | **—** | 101 | 2 |
| Fidelis Commercial | 104 | 107 | 107 | 107 | 15 | 4 | 4 |
| Fidelis Low-Cost | 1 | 102 | 102 | 102 | 7 | 108 | 4 |
| Fidelis Medicaid | 0 | 103 | 103 | 103 | 3 | 6 | 4 |
| **Fidelis Medicare** | 110 | 7 | 108 | 108 | 102 | 151 | **5** |
| Horizon BCBS | 15 | 101 | 101 | 101 | 11 | 19 | 4 |
| Humana | 11 | 16 | 16 | 16 | 18 | 15 | 4 |
| Magnacare | 19 | 3 | 3 | 3 | 103 | 110 | 4 |
| Medicaid | 13 | 18 | 18 | 18 | 6 | 17 | 4 |
| Medicare A&B | 2 | 8 | 8 | 8 | 0 | 7 | 4 |
| Midlands Choice | 14 | 19 | 19 | 19 | 101 | 18 | 4 |
| NYSHIP | 3 | 9 | 9 | 9 | 10 | 8 | 4 |
| Oregon Care | 101 | 4 | 4 | 4 | **—** | 105 | 3 |
| **Stedi** | 107 | — | — | — | — | — | 1 |
| **Stedi Test Payer** | — | — | — | — | — | 1 | 1 |
| UMR | 102 | 6 | 6 | 6 | **—** | 106 | 3 |
| United Commercial | 4 | 10 | 10 | 10 | 12 | 2 | 4 |
| United Low-Cost | 109 | — | — | — | 106 | **—** | 2 |
| United Medicaid | 7 | 12 | 12 | 12 | 4 | 102 | 4 |
| United Medicare | 6 | 11 | 11 | 11 | 104 | 9 | 4 |
| Wellcare | 10 | 15 | 15 | 15 | 16 | 14 | 4 |

**Consequence.** An index is only meaningful against the board it came from. Any
code that writes `writeStatusIndex(itemId, col, n)` must have read `n` from *that*
board. Five of the six index sets are hardcoded in the SPA (§3).

---

## 2. Copy gaps — where a value silently becomes blank

Monday copies a status between boards by matching the label **text exactly**. When
the destination column has no identical label the automation **writes a blank and
nothing errors**.

This is not theoretical. `cardinal-api/src/labelparity.js` was written after
*Landon Rose's 2026-07-28 order lost its infusion set* to exactly this mechanism —
"every board and every log looked clean". That module already walks the real data
flow, **Welcome Call → Subscription → Order**, and fails CI on drift. It covers the
**infusion-set** columns only. Running its own `hopGaps()` against the **insurance**
columns on the same chain:

### 2.1 Primary Insurance

| Hop | Label | Result |
|---|---|---|
| Welcome Call → Subscription | `BCBS FL` | blanks — destination has no equivalent |
| Welcome Call → Subscription | `BCBS WY` | blanks — destination has no equivalent |
| Welcome Call → Subscription | `Oregon Care` | blanks — destination has no equivalent |
| Welcome Call → Subscription | `UMR` | blanks — destination has no equivalent |
| Welcome Call → Subscription | `Fidelis CHP` | blanks — destination has no equivalent |
| Subscription → Order | `United Low-Cost` | blanks — destination has no equivalent |

**Six payers lose their insurance on a board hop.** A `BCBS WY` patient reaches the
Subscription board with Primary Insurance **empty**.

There are no whitespace twins and no case-only mismatches along this chain — every
board spells it `Magnacare`, and the `MagnaCare` spelling exists only in code (§3.4).

### 2.2 Secondary Insurance

| Hop | Label | Result |
|---|---|---|
| Welcome Call → Subscription | `Done` | blanks — but see §5.2; this is a junk label, not a payer |

Subscription → Order is clean.

---

## 3. The SPA's five hardcoded tables

| File | Board it encodes | Shape |
|---|---|---|
| `src/lib/subscription/workflow.ts:220` | Subscription | `PRIMARY_INSURANCE_OPTIONS` — 24 `{index,label}` |
| `src/lib/welcomeCall/workflow.ts:179` | Welcome Call | `PRIMARY_INSURANCE_OPTIONS` — 29 `{index,label}` |
| `src/lib/finalConfirm/workflow.ts:198` | Welcome Call (2nd copy) | `PRIMARY_INSURANCE_OPTIONS` — 29 `{index,label}` |
| `src/lib/samantha/hcpcRules.ts:246`,`258` | Insurance | `PrimaryInsurance` union + `PRIMARY_INSURANCE_INDEX` |
| `src/lib/profile/mondayMapping.ts:186` | Profile Send Off | `PRIMARY_INSURANCE_INDEX` — 29 label→index |

The **Order board has no SPA table** — this app never reads or writes it. Its only
mention in the codebase is a comment in `src/lib/shared/pos.ts:25`. The Order board
is owned by the automations and by `cardinal-api`.

### 3.1 Board label the app cannot select

| Board | Label | Effect |
|---|---|---|
| Subscription | `United Low-Cost` (106) | Not in `PRIMARY_INSURANCE_OPTIONS`. A rep cannot pick it. It renders correctly if already set (`EditableStatusSelect` displays `currentLabel` verbatim), so this is invisible until someone needs it. |

### 3.2 App option the board does not have

| File | Label | Effect |
|---|---|---|
| `welcomeCall/workflow.ts`, `finalConfirm/workflow.ts` | `United Healthcare Commercial` → index **7** | The Welcome Call column has **no index 7** (its labels run 0–4, 6, 8–19, 101–110). Picking it writes an index the column does not define. |

### 3.3 Board label the Insurance reader cannot parse

`src/lib/samantha/mondayMapping.ts:221` resolves the label through
`findExact(PRIMARY_INSURANCE_OPTIONS, …)`, which returns `""` on no match.

| Label | On board | In `hcpcRules.PrimaryInsurance` | Result |
|---|---|---|---|
| `Fidelis CHP` | Insurance ✓, Welcome Call ✓, Masheke ✓, Order ✓ | **✗** | `primaryInsurance = ""` |

Everything downstream of that empty string degrades without an error:

1. `resolveHcpcs("")` returns `[]` → **no product cards** on Benefits, Submit Auth,
   or Auth Outstanding. The stage looks like it has nothing to do.
2. `SUPPLY_HCPC_GROUP_BY_PAYER` miss → HCPC renders `"Evaluate"`.
3. `PAYER_RATE_SCHEDULE` miss → OOP estimate refuses.
4. `oversight/priority.ts:44` → scores 0 priority points.

Note `Fidelis CHP` **is** present in `hcpcRules.PRIMARY_INSURANCE_INDEX` (110) — so
the app can *write* it but not *read* it back.

### 3.4 Casing

Every board spells it **`Magnacare`**. Most code spells it **`MagnaCare`**. This is
currently harmless because each consumer bridges it independently — `findExact` and
Cardinal's `normalizeLabel` fold case, and both OOP estimators carry an explicit
alias (`welcomeCall/oopEstimator.ts:224` `PRIMARY_INSURANCE_ALIASES`,
`profile/oopEstimate.ts:33` `ALIASES`, both mapping `Magnacare→MagnaCare` and
`BCBS Wyoming→BCBS WY`). It is four independent bridges for one avoidable
discrepancy, and `pos.ts` `BCBS_FAMILY` is a **case-sensitive** `Set` that would not
bridge it if a Blue were ever spelled this way.

### 3.5 Payers that can never produce an OOP estimate

Every rate in these rows of `PAYER_RATE_SCHEDULE` is `null`, so no estimate line is
ever built and the estimator returns `{ok: false, reason: 'No rates available…'}`:

`BCBS TN` · `BCBS FL` · `BCBS WY` · `United Medicaid` · `United Low-Cost` ·
`MagnaCare` · `UMR` · `Oregon Care`

That is **8 of 28** payers. This may be intentional (no negotiated rate on file),
but it is indistinguishable in the UI from a lookup failure.

---

## 4. Cardinal — `medically-modern/cardinal-api`

`src/insurancemap.js` `ROUTING` maps a board label to the two fields Cardinal
receives: a shortened payer `name` and an `insuranceInfo.type` (only ever
`Medicare`, `Medicare Advantage`, or `Managed Medicaid`). 28 rows, approved by Josh
2026-06-23 from *"Cardinal Insurance Type Mapping - Sheet1"*.

**This layer fails safe**, and is the only one that does: an unknown label yields
`type: ''`, and the payload gate then blocks the order rather than sending a guess.

### 4.1 Order-board labels Cardinal cannot route

| Label | Cardinal type | Effect |
|---|---|---|
| **`BCBS Wyoming`** (104) | `""` | **Order blocked.** |
| `Stedi Test Payer` (1) | `""` | Order blocked — test label, see §5.1 |
| `CASH` (152) | `""` | Order blocked — not an insurance, see §5.1 |

`BCBS Wyoming` is the live finding. Cardinal knows `BCBS WY`; the Subscription and
Order boards spell it `BCBS Wyoming`. Combined with §2.1, a Wyoming Blue patient is
broken **twice** on the way through:

```
Welcome Call  "BCBS WY" (2)
      │  label not on destination
      ▼
Subscription  ⟨blank⟩            ← §2.1 copy gap
      │  (if a rep sets "BCBS Wyoming" (19) by hand)
      ▼
Order         "BCBS Wyoming" (104)
      │  not in Cardinal ROUTING
      ▼
Cardinal      type "" → ORDER BLOCKED
```

Every Cardinal `ROUTING` key does have a matching Order-board label, so the gap is
one-directional.

### 4.2 A known drift already flagged in that repo

`cardinal-api/src/orderBuilder.js:97` `isMedicare()` still uses
`label.toLowerCase().includes('medicare')` and is **deliberately not reconciled**
with `insurancemap`. Its own comment notes that `Humana` and `WellCare` now
classify as Medicare Advantage but contain no `"medicare"`. It is currently a no-op
because every `medicareSku` equals the standard SKU — but it is a live trap for
whoever activates Medicare-specific SKUs.

---

## 5. Labels that should not be in a billing column

### 5.1 Order board, Primary Insurance

| Index | Label | Problem |
|---|---|---|
| 103 / 104 | `BCBS WY` **and** `BCBS Wyoming` | **The same payer, twice.** One routes in Cardinal, the other blocks. Exactly the duplicate-label class that caused the 2026-07 infusion-set incident. |
| 1 | `Stedi Test Payer` | Test data in a production billing column. |
| 152 | `CASH` | A payment method, not an insurance. Blocks at Cardinal. |
| 5 | *(empty string)* | Monday's reserved blank sentinel — expected, ignore. |

### 5.2 Secondary Insurance — four different schemes

| Board | Column | Labels |
|---|---|---|
| Profile Send Off | `color_mm1zbrx0` | 0 NY Medicaid · 1 Medicare Supplement · 3 None |
| Welcome Call / Insurance | `color_mm241kqp` | 0 None · 1 NY Medicaid · 2 Medicare Supplement · **3 Done** |
| Subscription | `color_mm25cr82` | 0 None · 1 NY Medicaid · **2 Other** · 3 Medicare Supplement |
| Order | `color_mm18h6yn` | 0 NY Medicaid · **1 Patient** · 2 Medicare Supplement · 3 None · **4 Other** |

`Done` is a leftover from a status column's default palette. `Patient` and `Other`
are not secondary insurers. None of the four are offered by the SPA, so they can
only arrive from an automation or a manual edit — but nothing rejects them.

The SPA's three secondary tables (`subscription`, `welcomeCall`/`finalConfirm`,
`samantha/hcpcRules`, `profile/mondayMapping`) each match their own board correctly.

### 5.3 General Insurance (Profile Send Off, `color_mm24ap4j`)

`Other` (15) exists on the board but is **missing from
`profile/mondayMapping.ts:198` `GENERAL_INSURANCE_INDEX`** — so a rep cannot select
it, and since General Insurance is one of the four columns Stedi reads, an item left
on `Other` cannot be corrected from the SPA.

---

## 6. What guards any of this today

| Guard | Covers | Gap |
|---|---|---|
| `src/lib/shared/pos.test.ts` | Welcome Call ↔ Final Confirm option lists agree; BCBS family labels exist on both | Both are the **same board**. Subscription, Profile, Insurance and Order are unguarded. |
| `cardinal-api/src/labelparity.js` + `npm run check:labels` | Welcome Call → Subscription → Order, **infusion sets only** | The insurance columns travel the identical chain and are not checked. |
| `src/lib/shared/statusOptions.ts` | Live label→index reads, used by the Subscription **infusion-set** dropdowns | Insurance dropdowns still hardcode indexes — the pattern this module exists to replace. |
| `insurancemap.js` startup assertion | Every `ROUTING` row has a valid name and Cardinal type | Cannot detect a board label that has **no** row. |

Full SPA suite at time of writing: **74 files / 1009 tests, all passing.** None of
the mismatches above fails a test.

---

## 7. Recommendations, in order of payoff

1. **Fix `BCBS Wyoming`.** It is the only mismatch currently blocking real orders.
   Either add `BCBS Wyoming` to Cardinal's `ROUTING`, or — better — rename the
   Subscription and Order labels to `BCBS WY` and delete the duplicate, so one payer
   has one spelling. A rename keeps the index and does not churn existing items.
2. **Point `labelparity.js` at the insurance columns.** The module, the chain, the
   CI hook and the cron are already built; this is adding entries to `COLUMNS` and
   `HOPS`. It would have caught 6 of the findings in this document.
3. **Close the six copy gaps** in §2.1 by creating the missing labels, or by
   accepting them explicitly and documenting why a payer stops at Welcome Call.
4. **Add `Fidelis CHP` to `hcpcRules.ts`** — union, options, supply group, rate
   schedule. Those patients currently have no product cards anywhere in Insurance.
5. **Migrate the insurance dropdowns to `useStatusOptions`.** This deletes §3.1 and
   §3.2 permanently and makes future payers a board-only change for the SPA. It does
   **not** help §3.3–§3.5 or §4 — those are genuine business rules that must be
   decided per payer.
6. **Remove `Stedi Test Payer` and `CASH`** from the Order board's insurance column.
7. **Delete `assignments.json`-style dead labels** — `Done`, `Patient`, `Other` — or
   document what they mean.

---

## 8. Adding a new payer — the checklist

Derived from everything above. A payer is **not** added until all of these are done.

**Boards** (read back each `settings_str` for the index Monday actually assigned —
never assume):

- [ ] Profile Send Off `color_mm1xg10n`
- [ ] Medical Evaluation `color_mm1x157j`
- [ ] Insurance `color_mm1x157j`
- [ ] Welcome Call `color_mm1x157j`
- [ ] Subscription `color_mm254qxj`
- [ ] Order `color_mm18jhq5`

**SPA code** (`medically-modern/command-center-test`):

- [ ] `src/lib/profile/mondayMapping.ts` `PRIMARY_INSURANCE_INDEX`
- [ ] `src/lib/welcomeCall/workflow.ts` `PRIMARY_INSURANCE_OPTIONS`
- [ ] `src/lib/finalConfirm/workflow.ts` `PRIMARY_INSURANCE_OPTIONS`
- [ ] `src/lib/subscription/workflow.ts` `PRIMARY_INSURANCE_OPTIONS`
- [ ] `src/lib/samantha/hcpcRules.ts` — `PrimaryInsurance` union, `PRIMARY_INSURANCE_OPTIONS`, `PRIMARY_INSURANCE_INDEX`, `SUPPLY_HCPC_GROUP_BY_PAYER` (A/B/C), and `SUPPLIES_NEED_NY_MEDICAID_SECONDARY` if managed Medicaid
- [ ] `src/lib/welcomeCall/oopEstimator.ts` — `PAYER_RATE_SCHEDULE`, and membership in `MEDICARE_STYLE_INFUSION_PAYERS` / `AETNA_STYLE_PAYERS` / `SUPPLIES_ROUTE_TO_MEDICAID` / `PRIMARY_MEDICAID_LABELS` / `ZERO_OOP_PAYERS`
- [ ] `src/lib/profile/oopEstimate.ts` — the parallel `MEDICARE_STYLE` / `SUPPLIES_TO_MEDICAID` / `PRIMARY_MEDICAID` / `ZERO_PAYERS` sets
- [ ] `src/lib/shared/pos.ts` `BCBS_FAMILY` — only if it is a Blue
- [ ] `src/lib/oversight/priority.ts` — scoring tier
- [ ] `src/lib/profile/primaryInsurance.ts` `carrierFromPayer` — or Stedi will keep returning "New carrier — verify"

**Cardinal** (`medically-modern/cardinal-api`):

- [ ] `src/insurancemap.js` `ROUTING` — short `name` + Cardinal `type`, `direct` or `split`, from the Cardinal Insurance Type Mapping sheet

**Backend** (Railway, separate repos):

- [ ] `stedi-monday-integration` `insurance_rules.py` — `hcpcRules.ts` mirrors it and there is no drift check

**Monday automations:**

- [ ] Payer-gated automation conditions are stored as `{value: <index>, title: <label>}` and match on **index**, so a new label breaks nothing existing — but it matches **none** of them and falls through every payer-gated branch. Check whether it needs adding to any.

**Naming:**

- [ ] A label containing `medicaid` or `medicare` changes behaviour via substring
      rules — `benefitsDerive.patientHasMedicaidIns`, `samantha/workflow`
      (60- vs 90-day supply cadence), `finalConfirm/checkPack` C1/C6/C9,
      `profile/workflow` cross-sell gating, and `orderBuilder.isMedicare`.
      **The string you choose is business logic.** Pick it deliberately.

---

## 9. Change log

### 2026-08-10 — CDPHP (Capital District Physicians' Health Plan)

Requested by Josh: add **CDPHP** as a Primary Insurance option on the **Subscription
board** and the **Order board**, and as an option in the **Cardinal API ordering
service**.

**Applied.** The board label Josh created is:

```
CDPHP (capital district physicans' healthcare network)
```

54 characters, plain ASCII apostrophe, **byte-identical on both boards** — verified
against `settings_str`, so the Subscription → Order copy matches and does not blank
(§2).

| Step | State |
|---|---|
| Subscription board `color_mm254qxj` | **done** — index **107** |
| Order board `color_mm18jhq5` | **done** — index **153** |
| `subscription/workflow.ts` `PRIMARY_INSURANCE_OPTIONS` | **done** — `{ index: 107, label: "CDPHP (capital district physicans' healthcare network)" }`, index read back from the live column, not assumed |
| Cardinal `insurancemap.js` `ROUTING` | **done** — keyed on the full board label **and** on bare `CDPHP`, both → `split('CDPHP', 'Managed Medicaid', 'Managed Medicaid')` |

**Cardinal type.** Confirmed by Josh 2026-08-10: `Managed Medicaid` in **both**
buckets — the same shape as `NYSHIP`, `UMR`, `BCBS WY` and `Oregon Care`. Because
the buckets are equal, `classifyInsurance` needs no DOB, so a missing or
unparseable DOB cannot block a CDPHP order. Cardinal receives `name: "CDPHP"`
regardless of which spelling the board carries.

> **This document's own thesis caught a live bug during this change.** The Cardinal
> row was first written keyed on `'CDPHP'`, on the assumption that the board label
> would be the short brand. The label Josh actually created is the long
> parenthetical, and `normalizeLabel` folds only case and whitespace — so
> `classifyInsurance` returned `type: ""` and **every CDPHP order would have been
> blocked**. Caught by reading the label back from `settings_str` instead of
> assuming it. The routing table is now keyed on both spellings.

**Two known-imperfect things about the label, deliberately left alone:**

1. `physicans'` is misspelled (should be `physicians'`), and the payer's real name
   is Capital District Physicians' Health **Plan**, not "healthcare network".
2. At 54 characters it is nearly 3× the longest existing label
   (`Anthem BCBS Medicaid (JLJ)`, 26) and will wrap in the Subscription dropdown.

Neither is worth an unplanned board edit. **Shortening it to `CDPHP` is the
recommended cleanup** — it matches every other carrier on these columns, and while
no item carries the value yet a rename is free (a status rename keeps the index).
If it is done, exactly two things change: the `label` string in
`subscription/workflow.ts` (display-only, the index is the binding), and
`CDPHP_BOARD_LABEL` in `cardinal-api/test/transform.test.js`. The Cardinal
`ROUTING` table already carries the bare `CDPHP` key for precisely this reason and
needs no edit. **Rename both boards together or not at all** — renaming one blanks
the hop.

**Scope is deliberately partial** (confirmed by Josh): CDPHP is being added to the
Subscription and Order boards **only**. A CDPHP patient therefore cannot be entered
at Profile Send Off, Welcome Call, or Insurance — the payer supports the
*existing-subscriber-changed-insurance* path (the `Insurance Change?` column,
`color_mm2p8v3m`) but **not a new referral**. Recorded here so it is not later
mistaken for an oversight. Consequences that follow from that scope, none of which
are bugs:

- No `hcpcRules.ts` entry, so CDPHP has no HCPC supply group. Correct while no
  CDPHP patient reaches the Insurance board.
- No `PAYER_RATE_SCHEDULE` row, so no OOP estimate. Same reasoning — and 8 existing
  payers are already in that state (§3.5).
- No `primaryInsurance.ts` suggestion mapping, so a Stedi check naming CDPHP returns
  "New carrier — verify". Correct: Profile Send-Off is not a CDPHP entry point.

Widening the scope later means working the full §8 checklist, not just adding four
more board labels.
