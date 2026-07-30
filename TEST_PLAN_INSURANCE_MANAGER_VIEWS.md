# Test plan — Insurance manager views (reason buckets + two-step Submit Auth)

Covers commits `30d8355`…`8664e09` on `main` (2026-07-29/30). Written as a
handoff: **create the Monday state in §2, then walk §3 once** and every new bar
and button is exercised in a single pass.

Read [`OVERSIGHT_CHART_RULES.md`](OVERSIGHT_CHART_RULES.md) §3 for the rules
these tests assert.

---

## 0. Why you must create state first

As of 2026-07-30 **every new bar renders 0** — verified against the live board:

| Card | Bars | Live count |
|---|---|---|
| Benefits · Manager Intervention | Inactive / Pump SoS / >5d | 0 / 0 / 0 |
| Benefits · Final Decisions | Proposed / Universal | 0 / 0 |
| Submit Auth · Manager Intervention | DVS Retry / DVS Manual / Proposed | 0 / 0 / 0 |

Board state: 18 patients at `Benefits / SoS`, 1 at `Submit Auth.`, **0 at
`DVS`**; all 18 Benefits patients have blank Escalation and blank
`In-Network?` / `Active?` / `DME Benefits?`. **Empty cards are correct, not a
bug.** Nothing is testable until you seed the columns below.

---

## 1. Board + column reference

Insurance board **`18410601299`**. Groups: Benefits `group_mm1xr3q3` ·
Submit Auth `group_mm1x1416` · Auth Outstanding `group_mm2v6d1z` ·
DVS `group_mm5gp2r2` · Auth Denied `group_mm316hg2`.

| Column | ID | Labels (index) |
|---|---|---|
| Stage Advancer | `color_mm1ws96t` | `Benefits / SoS`(3) · `Submit Auth.`(4) · `Auth. Outstanding`(6) · `DVS`(1) · `Auth Denied`(0) · `Stuck / Don't Proceed`(2) · `Complete`(7) |
| Escalation | `color_mm2vsh2f` | `Manager Escalation Required`(0) · `Done`(1) · `Final Escalation Required`(2) |
| In-Network? | `color_mm2vhwan` | `In-Network`(1) · `Out-of-Network`(2) · `Medicare not Primary`(**11**) |
| Active? | `color_mm5q9y3` | `Active`(1) · `Inactive`(2) |
| DME Benefits? | `color_mm2vt8xg` | `Yes`(1) · `Partial / No`(2) |
| Days Since Stage Started | `color_mm1wwm05` | `0–2`(0) `3–5`(1) `6–8`(2) `9–12`(3) `13-15`(4) `16-20`(6) `21-29`(7) `30+`(8) — **index 5 unused** |
| Not Clear Products | `dropdown_mm2vez5a` | `Insulin Pump`(1) · CGM Monitor(2) · CGM Sensors(3) · Infusion Sets(4) · Cartridges(5) |
| Reference Notes | `long_text_mm2ffsme` | free text — carries the `[Proposed Stuck` stamp |
| Trigger Supplies DVS | `color_mm26pk1a` | `MLTC`(0) · `Failed`(4) · `Manual Review`(6) · `Retry Queued`(7) |
| Trigger Pump DVS | `color_mm578kbd` | `MLTC`(0) · `Failed`(4) · `Manual Review`(6) · `Denied`(9) — **no `Retry Queued` label** |
| S Claims Status | `color_mm284z0b` | `Claims Error`(0) · `Claims Denied`(3) · `Payment Incorrect`(4) |

> ⚠️ **Write by INDEX, not label text.** The Days labels mix en-dashes
> (`6–8 Days`) and hyphens (`13-15 Days`), and a text write with the wrong dash
> silently creates a duplicate board label (CLAUDE.md §9).

### Two automation traps while seeding

1. **`7921298383` is live:** *when Days Since Stage Started **changes to**
   `6–8 Days` AND Stage Advancer is `Benefits / SoS` → Escalation =
   `Manager Escalation Required`.* So setting Days to `6–8` on a Benefits
   patient **will overwrite your Escalation value**. Set Days *first*, then
   Escalation, on any patient that needs `Final`.
2. **It fires on the transition into `6–8` only.** Patients already at 9–12 /
   30+ were never flipped — that's why 17 real overdue patients don't show in
   the `>5d` bar. Don't treat that as a test failure (see §4).

---

## 2. What to create in Monday

Name every item with a `TEST ` prefix so nobody mistakes it for a patient.
Create them **in the group matching their stage**, then set the columns. If a
"when item created" automation overwrites a column, just set it again.

| # | Item name | Group | Set these columns | Lights up |
|---|---|---|---|---|
| **P1** | `TEST Benefits triple` | Benefits | Stage=`Benefits / SoS` · Active?=`Inactive` · Not Clear Products=`Insulin Pump` · Days=`6–8 Days` *(the automation sets Escalation=Manager for you — verify it did)* | **All 3** Benefits manager bars + the "in multiple bars" footnote |
| **P2** | `TEST Benefits proposed` | Benefits | Stage=`Benefits / SoS` · Escalation=`Final Escalation Required` · Reference Notes = `[Proposed Stuck · 2026-07-30 · TEST] Payer denied twice, no peer-to-peer` | Benefits Final → **Propose Stuck** bar |
| **P3** | `TEST Benefits universal` | Benefits | Stage=`Benefits / SoS` · Escalation=`Final` · In-Network?=`Out-of-Network` · DME Benefits?=`Partial / No` | Benefits Final → **Universal Check** bar |
| **P4** | `TEST Benefits both` | Benefits | Stage=`Benefits / SoS` · Escalation=`Final` · In-Network?=`Medicare not Primary` · Reference Notes = `[Proposed Stuck · 2026-07-30 · TEST] rep gave up` | **Both** Final bars (multi-bar footnote) + proves the new label reads back |
| **P5** | `TEST Benefits no-bar` | Benefits | Stage=`Benefits / SoS` · Escalation=`Final` · nothing else | Benefits Final **"+1 in no bar"** footnote |
| **P6** | `TEST DVS retry` | DVS | Stage=`DVS` · Trigger Supplies DVS=`Retry Queued` | Submit Auth manager → **DVS Retry** bar |
| **P7** | `TEST DVS manual escalated` | DVS | Stage=`DVS` · Trigger Supplies DVS=`Manual Review` · Escalation=`Manager Escalation Required` | **DVS Manual** bar **and** proves escalated DVS patients now appear in `/dvs` |
| **P8** | `TEST SA proposed` | Submit Auth | Stage=`Submit Auth.` · Escalation=`Manager Escalation Required` · Reference Notes = `[Proposed Stuck · 2026-07-30 · TEST] Auth portal rejects the NPI` | Submit Auth manager → **Propose Stuck** bar + the **Escalate to Final / Return to Queue** buttons |
| **P9** | `TEST SA final` | Submit Auth | Stage=`Submit Auth.` · Escalation=`Final` | Submit Auth **Final Decisions** card |
| **P10** | `TEST AO final` | Auth Outstanding | Stage=`Auth. Outstanding` · Escalation=`Final` | Auth Outstanding **Final Decisions** card |

**Expected bar counts after seeding** (`/system-mgmt?tab=oversight&stage=insurance`):

```
Benefits · Manager        header 1   Inactive 1 | Pump SoS 1 | >5 days 1   "1 in multiple bars"
Benefits · Final          header 4   Proposed 2 | Universal 2             "1 in multiple bars · +1 in no bar"
Submit Auth · Manager     header 3   DVS Retry 1 | DVS Manual 1 | Proposed 1
Submit Auth · Final       header 1
Auth Outstanding · Final  header 1
```

If Benefits · Manager shows **0** for `>5 days`, automation `7921298383` didn't
fire — check P1's Escalation is actually `Manager Escalation Required`.

---

## 3. The single walkthrough

### 3a. Oversight charts — `/system-mgmt?tab=oversight&stage=insurance`

1. The two manager cards render **labelled reason bars**, not 8 day buckets.
   Bars are wider, each with its own colour + short label underneath.
2. Counts match the table above; footnotes appear on the two cards that need
   them. **Bars summing past the header count is correct** — that's what the
   footnote explains.
3. Click **Inactive** on Benefits · Manager → drill-down opens filtered to that
   bar; the strip at the top shows reason bars (not day buckets) with the
   clicked one ring-highlighted. First column is **Reason** (pills), and P1
   shows all three reasons.
4. Click **Clear filters** → all rows return.
5. On Benefits · Final, confirm **Proposed Reason** shows P2/P4's stamped text
   and is blank for P3/P5.

### 3b. The new manager action — Submit Auth · Manager Intervention

6. Open that card's drill-down. **P8 (Proposed) has two buttons**; P6/P7 (DVS
   rows) show `—`.
7. Click **Escalate to Final** on P8 → modal opens, note field marked required,
   **confirm button is disabled while empty**. Type a reason → enables.
8. Confirm → toast "Escalated — sent to Final Decisions"; the row disappears
   from this card. On the board, P8's Escalation is now `Final Escalation
   Required` and Reference Notes carries **both** the rep's
   `[Proposed Stuck …]` line **and** your `[Escalated to Final · … · <initials>]`
   line. It now appears under **Submit Auth · Final Decisions**.
9. Back on the card, click **Return to Queue** on a re-seeded P8 → escalation
   clears, Follow Up Date = today.

### 3c. Click-through routing

10. From Benefits · Manager, click **P1's row** → opens `/benefits` with the
    patient pinned, in **manager mode** (`manager=1&escalated=1`) because P1
    carries the Manager label.
11. Temporarily clear P1's Escalation and click again → opens `/benefits` as a
    **plain rep page** (no red escalated styling, unfiltered sidebar). That's
    the review fix — a non-escalated patient must not land in an
    escalated-only sidebar. Restore P1's Escalation afterwards.
12. From Submit Auth · Manager, click **P7** → `/dvs`. **P7 must be listed in
    the rail** despite its Manager escalation (the change requested
    2026-07-29). Click **P8** → `/submit-auth`, not `/dvs`.

### 3d. Benefits panel — the column split + Medicare not Primary

Use a scratch Benefits patient (P1 is fine).

13. Set primary insurance = **Medicare A&B**. Check 01 offers **In-Network /
    Medicare not Primary** — **no Out-of-Network**. Two buttons, same width as
    the other checks.
14. Pick **Medicare not Primary** → red prompt appears; the send button is
    **disabled**. Enter a Ref # only → still disabled. Add a **call note** →
    unlocks. *(The gate is the Universal Checks call log, not the notes rail.)*
15. Set Active = `Not Active`, DME = `Not Covered`, and send. Board should read
    `In-Network? = Medicare not Primary` (dark red) · `Active? = Inactive` ·
    `DME = Partial / No` · **`Escalation = Final Escalation Required`**
    (Medicare outranks Inactive).
16. **Reload the patient** — all three answers come back selected. *(This is
    the regression the column split caused: before the fix both In-Network and
    Active hydrated blank on every load.)*
17. Different patient, non-Medicare payer: In-Network=`Yes`, **Active=`Not
    Active`**, DME=`Yes`, send → Escalation must be **`Manager Escalation
    Required`**, not Final. Patient joins the Benefits manager *Inactive* bar.
18. Switch a Medicare-not-Primary patient's payer to a non-Medicare plan →
    Check 01 reverts to In-Network / Out-of-Network and the stale answer
    self-clears.
19. Propose Stuck from `/benefits` → lands in **Final Decisions**. Propose
    Stuck from `/submit-auth` → lands in **Manager Intervention**.
20. On a patient already at `Final`, re-Propose Stuck from `/submit-auth` →
    Escalation **stays Final** (no downgrade), stamp still appended.

### 3e. Cleanup

Delete P1–P10 when done, or move them to `Complete`. Leaving them in
`Benefits / SoS` inflates the reps' real queues and tomorrow's burndown
baseline.

---

## 4. Known-correct behaviours that look like bugs

| Looks wrong | Actually |
|---|---|
| `>5 days` bar is 0 while 17 patients sit at 9–12 / 30+ days | Automation `7921298383` fires only on the **transition into** `6–8 Days`; those patients were never flipped. Fix on the board: one-time bulk-set Escalation on existing overdue patients, and/or extend the recipe to the later buckets. |
| Bars sum to **more** than the card header | A patient can match several reasons; header = distinct patients. The footnote says so. |
| Bars sum to **less** than the header | Benefits · Final is categorize-mode: a Final-escalated patient matching neither bar (P5) counts in the header only. Footnote `+N in no bar`. |
| `Active?` blank on old patients | **211 of 249** items have `In-Network? = In-Network` but `Active?` blank — the backfill has never run. `Active? = Active` is provably right for those 211 (the old combined column only wrote index 1 when both checks passed). Not done yet; worth doing. |
| Pump half of the DVS Retry bar never matches | `Trigger Pump DVS` has no `Retry Queued` label. Wired for when Brandon adds it. |
| A manager Return-to-Queue drops a patient off `>5d` for good | The automation won't re-fire as days climb. Confirm with Katie that's the intent. |

---

## 5. Running the app in a container (recipe that worked)

No project run skill exists; these are the gotchas hit on 2026-07-30.

- **Dev server:** `vite.config.ts` binds `host: "::"` / port 8080, which fails
  with `EAFNOSUPPORT` in the container. Use:
  `npx vite --host 127.0.0.1 --port 8080`
- **Auth:** dev mode has **no login gate** — `VITE_GOOGLE_CLIENT_ID` lives only
  in `.env.production`, so `AuthGate` is inert under `vite dev`.
- **Live Monday data:** prefix with
  `VITE_MONDAY_GATEWAY_URL=https://monday-gateway-production.up.railway.app`.
  The URL is public (it ships in the client either way) and the gateway injects
  the token server-side; only `POST /send` requires a Google token, so **reads
  work unauthenticated**. Without it the charts render but every fetch fails.
- **Browser:** `chromium-cli` is not installed. Write a small Playwright
  driver — but `playwright@latest` expects browser build `1234` while the
  container ships `1194`, so **do not** run `playwright install`; launch with
  `executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"` and
  `args: ["--no-sandbox"]`.
- **PHI:** screenshot the **chart grid** (counts only). The drill-down table
  shows patient names — don't put it in artifacts or commits (CLAUDE.md §10).
- Revert any `playwright` devDependency before committing; it isn't a project
  dep.
