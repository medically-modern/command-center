# Monday Board Schema: Welcome Call
# Board ID: 18410804557
# Pulled: 2026-05-13

## Groups

- `group_mm1wvq8p` → Welcome Call
- `group_mm2x8jtj` → Final Profile Confirmation
- `group_mm1x5s5d` → Completed
- `group_mm1xyczx` → Stuck
- `group_mm1x5c0` → Escalation

## All Columns (with values)

### Name
- **ID:** `name`
- **Type:** `name`

### Subitems
- **ID:** `subtasks_mm25yj3d`
- **Type:** `subtasks`

### TIME IN PIPELINE -->
- **ID:** `color_mm1w32e5`
- **Type:** `status`
- **Values:**
  - `0` → TIME IN PIPELINE -->

### Date of Intake
- **ID:** `date_mm1wf43j`
- **Type:** `date`

### Date of Stage Start
- **ID:** `date_mm1w6jeq`
- **Type:** `date`

### Days Since Intake
- **ID:** `color_mm1xwabn`
- **Type:** `status`
- **Values:**
  - `0` → 0–2 Days
  - `1` → 3–5 Days
  - `2` → 6–8 Days
  - `3` → 9–12 Days
  - `4` → 13-15 Days
  - `6` → 16-20 Days
  - `7` → 21-29 Days
  - `8` → 30+ Days

### Days Since Stage Started
- **ID:** `color_mm1wwm05`
- **Type:** `status`
- **Values:**
  - `0` → 0–2 Days
  - `1` → 3–5 Days
  - `2` → 6–8 Days
  - `3` → 9–12 Days
  - `4` → 13-15 Days
  - `6` → 16-20 Days
  - `7` → 21-29 Days
  - `8` → 30+ Days

### Stage Advancer
- **ID:** `color_mm1ws96t`
- **Type:** `status`
- **Values:**
  - `0` → Review Profile
  - `2` → Stuck / Don't Proceed
  - `4` → Completed
  - `7` → Welcome Call

### Advance?
- **ID:** `color_mm301cpp`
- **Type:** `status`
- **Values:**
  - `1` → Advance
  - `2` → Don't Advance

### REFERRAL DETAILS -->
- **ID:** `color_mm1wrrqz`
- **Type:** `status`
- **Values:**
  - `0` → REFERRAL DETAILS -->

### Referral Type
- **ID:** `color_mm1wm4n4`
- **Type:** `status`
- **Values:**
  - `0` → Manufacturer
  - `1` → Payor
  - `2` → Patient
  - `3` → Doctor
  - `4` → Advocacy Group

### Referral Source
- **ID:** `color_mm1w5wxr`
- **Type:** `status`
- **Values:**
  - `0` → Patient
  - `1` → Tandem
  - `2` → Beta Bionics
  - `3` → CareCentrix
  - `4` → Doctor
  - `6` → Solace Advocates

### Pump Type
- **ID:** `color_mm1wjjtk`
- **Type:** `status`
- **Values:**
  - `0` → iLet
  - `1` → Mobi
  - `2` → t:slim
  - `3` → Not Serving
  - `4` → Minimed 780G

### CGM Type
- **ID:** `color_mm1w7pmf`
- **Type:** `status`
- **Values:**
  - `0` → FreeStyle Libre 14-Day
  - `1` → Guardian 4
  - `2` → Instinct
  - `3` → FreeStyle Libre 3 Plus
  - `4` → FreeStyle Libre 2 Plus
  - `6` → Dexcom G7
  - `7` → Dexcom G7 15-Day
  - `8` → Dexcom G6
  - `9` → Not Serving

### Request Type
- **ID:** `color_mm1w1978`
- **Type:** `status`
- **Values:**
  - `0` → Insulin Pump
  - `1` → Supplies Only
  - `2` → CGM
  - `3` → Insulin Pump + CGM
  - `4` → Supplies + CGM

### Serving
- **ID:** `color_mm1w1cm9`
- **Type:** `status`
- **Values:**
  - `0` → Insulin Pump
  - `1` → Supplies Only
  - `2` → CGM
  - `3` → Insulin Pump + CGM
  - `4` → Supplies + CGM

### MEDICAL NECESSITY WORKFLOW -->
- **ID:** `color_mm1x5a9r`
- **Type:** `status`
- **Values:**
  - `0` → MEDICAL NECESSITY WORKFLOW -->

### Diagnosis
- **ID:** `color_mm1wf7rv`
- **Type:** `status`
- **Values:**
  - `0` → E08.43
  - `1` → E10.10
  - `2` → E10.22
  - `3` → E10.29
  - `4` → E10.3559
  - `6` → E10.42
  - `7` → E10.649
  - `8` → E10.65
  - `9` → E10.69
  - `10` → E10.8
  - `11` → E10.9
  - `12` → E11.21
  - `13` → E11.22
  - `14` → E11.3292
  - `15` → E11.40
  - `16` → E11.42
  - `17` → E11.45
  - `18` → E11.59
  - `19` → E11.65
  - `101` → E11.69
  - `102` → E11.8
  - `103` → E11.9
  - `104` → E13.65
  - `105` → E13.9
  - `106` → O24.111
  - `107` → Evaluate
  - `108` → Collect
  - `109` → E10.3393
  - `110` → E024.414
  - `151` → E11.64
  - `152` → E10.311
  - `153` → E11.649
  - `154` → E11.29

### CGM Coverage Path
- **ID:** `color_mm2wsam4`
- **Type:** `status`
- **Values:**
  - `0` → Hypo
  - `1` → Insulin
  - `2` → Not Serving

### Insulin Pump Coverage Path
- **ID:** `color_mm2xtn41`
- **Type:** `status`
- **Values:**
  - `0` → Omnipod Switch
  - `1` → IW New Insurance
  - `2` → OOW Pump
  - `3` → 1st Pump >6M Diagnosed
  - `4` → 1st Pump <6M Diagnosed
  - `6` → Supplies Only
  - `7` → Not Serving

### MR Expiry Date
- **ID:** `date_mm1ymthz`
- **Type:** `date`

### Final Clinicals
- **ID:** `file_mm25m8c1`
- **Type:** `file`

### INSURANCE WORKFLOW -->
- **ID:** `color_mm1x3d9q`
- **Type:** `status`
- **Values:**
  - `0` → INSURANCE WORKFLOW -->

### MONITOR -->
- **ID:** `text_mm1xfb5w`
- **Type:** `text`

### CGM Auth Result
- **ID:** `color_mm1wgjd1`
- **Type:** `status`
- **Values:**
  - `0` → Evaluate
  - `1` → Auth Valid
  - `2` → Denied
  - `3` → No Auth Needed
  - `4` → Submitted
  - `6` → Required
  - `7` → Not Serving

### Monitor Auth ID
- **ID:** `text_mm1w1d5p`
- **Type:** `text`

### Monitor Auth Start
- **ID:** `date_mm1wj1bz`
- **Type:** `date`

### Monitor Auth End
- **ID:** `date_mm1whebp`
- **Type:** `date`

### Monitor Auth Units
- **ID:** `numeric_mm2w5jdp`
- **Type:** `numbers`

### SENSORS -->
- **ID:** `text_mm1xw1zf`
- **Type:** `text`

### Sensors Auth Result
- **ID:** `color_mm1x5c99`
- **Type:** `status`
- **Values:**
  - `0` → Evaluate
  - `1` → Auth Valid
  - `2` → Denied
  - `3` → No Auth Needed
  - `4` → Submitted
  - `6` → Required
  - `7` → Not Serving

### Sensors Auth ID
- **ID:** `text_mm1x8tdp`
- **Type:** `text`

### Sensors Auth Start
- **ID:** `date_mm1x929`
- **Type:** `date`

### Sensors Auth End
- **ID:** `date_mm1xvnqb`
- **Type:** `date`

### Sensors Auth Unit
- **ID:** `numeric_mm2wgfrb`
- **Type:** `numbers`

### INSULIN PUMP -->
- **ID:** `text_mm1xy56a`
- **Type:** `text`

### IP Auth Result
- **ID:** `color_mm1xnzmn`
- **Type:** `status`
- **Values:**
  - `0` → Evaluate
  - `1` → Auth Valid
  - `2` → Denied
  - `3` → No Auth Needed
  - `4` → Submitted
  - `6` → Required
  - `7` → Not Serving

### IP Auth ID
- **ID:** `text_mm1xmj8x`
- **Type:** `text`

### IP Auth Start
- **ID:** `date_mm1xxbkz`
- **Type:** `date`

### IP Auth End
- **ID:** `date_mm1x2q3`
- **Type:** `date`

### IP Auth Units
- **ID:** `numeric_mm2wayp9`
- **Type:** `numbers`

### INFUSION SETS →
- **ID:** `text_mm1xmst`
- **Type:** `text`

### Infusion Set Auth Result
- **ID:** `color_mm1xr2j1`
- **Type:** `status`
- **Values:**
  - `0` → Evaluate
  - `1` → Auth Valid
  - `2` → Denied
  - `3` → No Auth Needed
  - `4` → Submitted
  - `6` → Required
  - `7` → Not Serving

### Infusion Set Auth ID
- **ID:** `text_mm1xf6ht`
- **Type:** `text`

### Infusion Set Auth Start
- **ID:** `date_mm1xrk1c`
- **Type:** `date`

### Infusion Set Auth End
- **ID:** `date_mm1xj3wp`
- **Type:** `date`

### Infusion Set Auth Units
- **ID:** `numeric_mm2wh4ph`
- **Type:** `numbers`

### A4230 Claim
- **ID:** `text_mm28a3xt`
- **Type:** `text`

### CARTRIDGES →
- **ID:** `text_mm1xyq75`
- **Type:** `text`

### Cartridge Auth Result
- **ID:** `color_mm1xybvt`
- **Type:** `status`
- **Values:**
  - `0` → Evaluate
  - `1` → Auth Valid
  - `2` → Denied
  - `3` → No Auth Needed
  - `4` → Submitted
  - `6` → Required
  - `7` → Not Serving

### Cartridge Auth ID
- **ID:** `text_mm1xs6s8`
- **Type:** `text`

### Cartridge Auth Start
- **ID:** `date_mm1xp0vm`
- **Type:** `date`

### Cartridge Auth End
- **ID:** `date_mm1xznf9`
- **Type:** `date`

### Cartridge Auth Units
- **ID:** `numeric_mm2wcgkc`
- **Type:** `numbers`

### A4232 Claim
- **ID:** `text_mm282cy5`
- **Type:** `text`

### Escalation
- **ID:** `color_mm1x7997`
- **Type:** `status`
- **Values:**
  - `0` → Escalation Required
  - `1` → Done

### Escalation Reason
- **ID:** `dropdown_mm2fhcd6`
- **Type:** `dropdown`
- **Options:**
  - `1` → Benefits Must Go Through Pharmacy

### Notes
- **ID:** `long_text_mm2ffsme`
- **Type:** `long_text`
- ⚠️ Being converted to `text` (no 2,000-char cap) — CLAUDE.md §10, 2026-09-03. The id may or may not survive the UI conversion; check `columns { id type }`, never the prefix. The app already writes it as a bare string via `change_multiple_column_values`, which both types accept.

### WELCOME CALL -->
- **ID:** `color_mm1xmhbg`
- **Type:** `status`
- **Values:**
  - `1` → WELCOME CALL -->

### Autotext Type
- **ID:** `color_mm1xzh1x`
- **Type:** `status`
- **Values:**
  - `0` → Beta Bionics
  - `1` → General Diabetes
  - `2` → Tandem
  - `4` → Tandem Supplies Only

### Welcome Call
- **ID:** `color_mm1xz44k`
- **Type:** `status`
- **Values:**
  - `0` → Attempt 1
  - `1` → Attempt 2
  - `2` → Attempt 3
  - `3` → Escalate

### Monitor Qty
- **ID:** `numeric_mm1xyfhc`
- **Type:** `numbers`

### Pump Qty
- **ID:** `numeric_mm1xa0z2`
- **Type:** `numbers`

### Qty Inf. 1
- **ID:** `numeric_mm1xv7wr`
- **Type:** `numbers`

### Infusion Set 1
- **ID:** `color_mm1x9paw`
- **Type:** `status`
- **Values:**
  - `0` → AutoSoft XC 6 mm 23"
  - `1` → AutoSoft XC 6 mm 32"
  - `2` → AutoSoft XC 6 mm 43"
  - `3` → AutoSoft XC 9 mm 23"
  - `4` → AutoSoft 30 13 mm 23"
  - `6` → TruSteel 6 mm 23"
  - `7` → TruSteel 6 mm 32"
  - `8` → TruSteel 8 mm 23"
  - `9` → TruSteel 8 mm 32"
  - `10` → VariSoft 13 mm 23"
  - `11` → VariSoft 13 mm 32"
  - `12` → VariSoft 17 mm 23"
  - `13` → Contact 6mm 23"
  - `14` → Inset 6mm 23"
  - `15` → AutoSoft XC 6 mm 5"
  - `16` → AutoSoft 90 6 mm 23"
  - `17` → AutoSoft 90 6 mm 43"
  - `18` → AutoSoft 90 9 mm 23"
  - `19` → AutoSoft 90 9 mm 43"
  - `101` → Not Serving
  - `102` → Mio Advance Clear 9mm 23"

### Qty Inf. 2
- **ID:** `numeric_mm1xkq3b`
- **Type:** `numbers`

### Qty Cartridge
- **ID:** `numeric_mm515sqv`
- **Type:** `numbers`
- Added 2026-07. Editable on the Welcome Call + Final Confirm views; the UI
  defaults it to **3** for pump/supplies patients (never stamped on CGM-only).

### Infusion Set 2
- **ID:** `color_mm1xekaz`
- **Type:** `status`
- **Values:**
  - `0` → AutoSoft 90 6 mm 23"
  - `1` → AutoSoft XC 6 mm 23"
  - `2` → AutoSoft 90 6 mm 43"
  - `3` → AutoSoft 90 9 mm 23"
  - `4` → AutoSoft 90 9 mm 43"
  - `6` → AutoSoft XC 6 mm 5"
  - `7` → AutoSoft XC 6 mm 32"
  - `8` → AutoSoft XC 6 mm 43"
  - `9` → AutoSoft XC 9 mm 23"
  - `10` → AutoSoft 30 13 mm 23"
  - `11` → TruSteel 6 mm 23"
  - `12` → TruSteel 6 mm 32"
  - `13` → TruSteel 8 mm 23"
  - `14` → TruSteel 8 mm 32"
  - `15` → VariSoft 13 mm 23"
  - `16` → VariSoft 13 mm 32"
  - `17` → VariSoft 17 mm 23"
  - `18` → Contact 6 mm 23"
  - `19` → Inset 6 mm 23"
  - `101` → Not Serving

### Subscription Type
- **ID:** `color_mm1xbqth`
- **Type:** `status`
- **Values:**
  - `0` → Sensors
  - `1` → Sensors & Supplies
  - `2` → Supplies

### Welcome Call Text
- **ID:** `color_mm1xtqvv`
- **Type:** `status`
- **Values:**
  - `0` → Send

### Order Handling
- **ID:** `color_mm2776fg`
- **Type:** `status`
- **Values:**
  - `0` → Separate
  - `1` → Together
  - `2` → Not Applicable

### DEMOGRAPHICS -->
- **ID:** `text_mm1x5p8`
- **Type:** `text`

### DOB
- **ID:** `text_mm1xvxst`
- **Type:** `text`

### Pt. Phone
- **ID:** `phone_mm1x44yk`
- **Type:** `phone`

### Address
- **ID:** `location_mm1xhw17`
- **Type:** `location`

### Email
- **ID:** `text_mm1xc140`
- **Type:** `text`

### Gender
- **ID:** `color_mm1x1bdg`
- **Type:** `status`
- **Values:**
  - `0` → Male
  - `1` → Female
  - `2` → Unknown

### INSURANCE -->
- **ID:** `text_mm1xp2e5`
- **Type:** `text`

### Primary Insurance
- **ID:** `color_mm1x157j`
- **Type:** `status`
- **Values:**
  - `0` → BCBS TN
  - `1` → BCBS FL
  - `2` → BCBS WY
  - `3` → MagnaCare
  - `4` → Oregon Care
  - `6` → UMR
  - `7` → United Healthcare Commercial
  - `8` → Medicare A&B
  - `9` → NYSHIP
  - `10` → United Commercial
  - `11` → United Medicare
  - `12` → United Medicaid
  - `13` → Aetna Commercial
  - `14` → Aetna Medicare
  - `15` → Wellcare
  - `16` → Humana
  - `17` → Cigna
  - `18` → Medicaid
  - `19` → Midlands Choice
  - `101` → Horizon BCBS
  - `102` → Fidelis Low-Cost
  - `103` → Fidelis Medicaid
  - `104` → Anthem BCBS Medicaid (JLJ)
  - `105` → Anthem BCBS Commercial
  - `106` → Anthem BCBS Medicare
  - `107` → Fidelis Commercial
  - `108` → Fidelis Medicare
  - `109` → Anthem BCBS Low-Cost (JLJ)
  - `110` → Fidelis CHP

### Member ID 1
- **ID:** `text_mm1x2qk2`
- **Type:** `text`

### Secondary Insurance
- **ID:** `color_mm241kqp`
- **Type:** `status`
- **Values:**
  - `0` → None
  - `1` → NY Medicaid
  - `2` → Medicare Supplement

### Member ID 2
- **ID:** `text_mm1xaccx`
- **Type:** `text`

### Plan Name
- **ID:** `dropdown_mm2wrzrk`
- **Type:** `dropdown`
- **Options:**
  - `0` → HealthierLife Plan
  - `1` → Aetna Choice POS II
  - `2` → DIRECT ACCESS

### Stedi QMB
- **ID:** `text_mm2wms12`
- **Type:** `text`

### Deductible
- **ID:** `text_mm1xkbqc`
- **Type:** `text`

### Deductible Remaining
- **ID:** `text_mm1xdzxw`
- **Type:** `text`

### OOP Max
- **ID:** `text_mm1xdtj7`
- **Type:** `text`

### OOP Max Remaining
- **ID:** `text_mm1xx5f`
- **Type:** `text`

### DOCTOR -->
- **ID:** `text_mm1x284n`
- **Type:** `text`

### Doctor Name
- **ID:** `text_mm1x46et`
- **Type:** `text`

### Doctor Phone
- **ID:** `phone_mm1xz8c0`
- **Type:** `phone`

### Doctor NPI
- **ID:** `text_mm1x7d91`
- **Type:** `text`

### Clinicals Method
- **ID:** `color_mm1xw7y5`
- **Type:** `status`
- **Values:**
  - `0` → Fax
  - `1` → Parachute
  - `2` → Email

### Doctor Email
- **ID:** `email_mm1x6fq5`
- **Type:** `email`

### Doctor Fax (@rcfax)
- **ID:** `email_mm1xdzcj`
- **Type:** `email`

### Clinic Name
- **ID:** `dropdown_mm1xbvas`
- **Type:** `dropdown`
- **Options:**
  - `1` → SUNY Upstate Pediatric - Joslin Diabetes Center
  - `2` → LAKEWOOD MEDICAL ASSOCIATES
  - `3` → Joslin Pediatric Educators
  - `4` → SUNY Upstate Pediatric Joslin Diabetes Center
  - `5` → NYU PEDIATRIC DIABETES CENTER
  - `6` → Albany Med Health System - AMC 220 Washington Community Endocrinology
  - `7` → NewYork-Presbyterian - Weill Greenberg Center
  - `8` → Diabetes and Endocrine Associates of Bridgewater Update Facility
  - `9` → Guthrie Endocrinology
  - `10` → NewYork-Presbyterian - Naomi Berrie Diabetes Center
  - `11` → ST. PETER'S HEALTH PARTNERS - ALBANY OFFICE
  - `12` → Upstate Medical University
  - `13` → NYU Langone - ACGC Endo 3rd FL
  - `14` → SUNY Upstate Joslin Diabetes Center
  - `15` → AMHS- SHMG Endocrinology
  - `16` → The Office Don Zwickler, MD
  - `17` → NYU Langone Great Neck
  - `18` → UPMC
  - `19` → Children's Hospital at Montefiore
  - `20` → RRH Diabetes and Endocrinology - Ridgeway Update Facility
  - `21` → Catholic Health Ronkonkoma
  - `22` → Grandview Medical Group
  - `23` → Montefiore - Medical ArtsPavillion
  - `24` → Mount St Marys Health Center
  - `25` → RRH Diabetes and
  - `26` → Endocrinology -
  - `27` → Ridgeway
  - `28` → NYU Langone
  - `29` → Primary Care of Western New York
  - `30` → Metropolitan Hospital Endocrinology
  - `31` → CVPH Endocrinology
  - `32` → Edward Condon Medical
  - `33` → Albany Med Health  System - 22 New  Scotland Division of  Pediatric Endocrinology
  - `34` → Catholic Health Ambulatory Care at West Babylon
  - `35` → NYU Diabetes and Endocrinology Associates
  - `36` → OPTUM Fishkill Westage Endocrinology
  - `37` → Atlantic Medical Group Endocrinology

### Clinic Address
- **ID:** `location_mm1xjnfv`
- **Type:** `location`

### OTHER -->
- **ID:** `color_mm1xxe31`
- **Type:** `status`
- **Values:**
  - `1` → OTHER -->

### Referral Received Date
- **ID:** `date_mm1x4e1r`
- **Type:** `date`

### monday Doc v2
- **ID:** `direct_doc_mm20qvd0`
- **Type:** `direct_doc`

### Call Attempts
- **ID:** `text_mm322fg9`
- **Type:** `text`

### CGM Last Bill Date
- **ID:** `date_mm33vqa0`
- **Type:** `date`

### Sensors Last Bill Date
- **ID:** `date_mm33jsyt`
- **Type:** `date`

### IP Last Bill Date
- **ID:** `date_mm33kmz4`
- **Type:** `date`

### Infusion Set Last Bill Date
- **ID:** `date_mm33mw14`
- **Type:** `date`

### Cartridge Last Bill Date
- **ID:** `date_mm33rd8n`
- **Type:** `date`

### IP Next Order Date
- **ID:** `date_mm356crn`
- **Type:** `date`

### Supplies Next Order Date
- **ID:** `date_mm351tva`
- **Type:** `date`

### Sensors Next Order Date
- **ID:** `date_mm35bdf8`
- **Type:** `date`

### Split
- **ID:** `color_mm381bgy`
- **Type:** `status`
- **Values:**
  - `1` → Split

### Josh Debug
- **ID:** `text_mm35b391`
- **Type:** `text`

### Follow Up
- **ID:** `color_mm38w2tk`
- **Type:** `status`
- **Values:**
  - `0` → Working on it
  - `1` → Done
  - `2` → Stuck

### Follow Up Date
- **ID:** `date_mm38a7k7`
- **Type:** `date`

### Stedi Coinsurance %
- **ID:** `text_mm391jq8`
- **Type:** `text`

---

## Added after the 2026-05-13 pull

The dump above is a point-in-time snapshot; these were added later and are
documented here rather than by re-pulling the whole board.

### Medicare Prior Pump Date
- **ID:** `text_mm58k9x9`
- **Type:** `text`
- MM/YYYY free text. Original Medicare (Medicare A&B) + Pump Qty ≠ 1 +
  pump/supplies serving. Benefits seeds the literal `TBD`; the rep replaces it
  with the real date. Copied on to Subscription `text_mm58erk3`.

### Monitor Purchase Date
- **ID:** `text_mm6693sn`
- **Type:** `text`
- MM/YYYY free text, added 2026-08-13. The CGM twin of the pump date above:
  Original Medicare + Monitor Qty ≠ 1 + CGM serving. **Auto-derived**, unlike
  the pump — see `src/lib/shared/monitorPurchaseDate.ts` and CLAUDE.md §5.14.
  Copied on to Subscription `text_mm66werp`.

### CGM Monitor SoS No Billing History
- **ID:** `boolean_mm5ad9rm`
- **Type:** `checkbox`
- Copied from Insurance `boolean_mm5a6haz` by create-item automation
  `7918324247`. Input to Monitor Purchase Date.

### CGM Monitor SoS Last Bill
- **ID:** `date_mm599gk8`
- **Type:** `date`
- Copied from Insurance `date_mm59tx2g` by the same automation. Input to
  Monitor Purchase Date.
