# Monday go-live checklist — DVS + Manager Views

What must happen **in Monday, in the Railway bots, and around the prod deploy** before this
system ships to production. Compiled 2026-07-21 from the live automation dumps (Insurance
board `18410601299`, Medical Evaluation board `18406060017`), the Brandon handoffs, and the
build ledger ([`MANAGER_VIEWS_DVS_BUILD.md`](MANAGER_VIEWS_DVS_BUILD.md)).

**Nothing here blocks the app from functioning** — the send-time DVS routing, CIN gate,
propose→approve stuck, and manager views all work today with zero Monday changes. This list
is what makes the *skip path* and bot plumbing production-grade.

Legend: ☐ todo · ⚠ risk to design around · ℹ verified fact, no action

---

## 1. Insurance board — automation edits (the skip path)

- ☐ **Edit automation `7918388123`** ("When an item is created, if Primary Insurance is
  Medicaid and Serving is Supplies Only"): change the **Stage Advancer** action from
  **"Submit Auth." → "DVS"**. Today this recipe already skips straight-Medicaid
  supplies-only patients past Benefits — it just sends them to the wrong stage. Leave the
  Infusion Set / Cartridge Auth Result = "Required" actions as-is.
- ☐ In the same recipe, **add an action: Trigger Supplies DVS → "Trigger Supplies DVS"**
  so today's bot actually fires on arrival (the stage flip alone triggers nothing until
  the v2 bot rework — §3). Skip this step if the bot rework lands first.
- ⚠ **On-create write race — test before trusting it.** Automation `7918283739` sets
  Stage Advancer = "Benefits / SoS" on **every** item creation, so after the edit two
  on-create automations write the same column with no ordering guarantee. If `7918283739`
  lands last it silently clobbers DVS back to Benefits — and unlike the current Submit
  Auth. version (where a lost write is visible because the item never moves groups), a
  lost DVS write is invisible. **Mitigations, pick one:** (a) test with a few throwaway
  items and confirm the ordering is stable; (b) remove the Stage Advancer action from
  `7918283739` and let `7918388123`-style conditional recipes own the stage on create,
  with a default-to-Benefits recipe as the fallback; (c) skip the board edit entirely and
  keep the current app-side routing (skip patients touch Benefits once, first send routes
  them — works today, verified writes, no race).
- ☐ **Decide: pump recipe now or later?** A sibling recipe (Medicaid + pump servings →
  Stage DVS + Trigger Pump DVS) completes the skip path, but the straight-Medicaid
  pump-denied handling is still an open question (§5) — reasonable to hold pump routing
  app-side until that's settled.
- ☐ **Optional: DVS group + "Stage Advancer changes to DVS → move item to group".** Pure
  board hygiene — the app queries by stage, not group, so nothing app-side changes. Note
  there is currently **no** automation triggered by Stage Advancer = "DVS" at all (ℹ
  verified), which is why stage-DVS items sit in their old group.
- ℹ **The DVS exit path already exists:** `7918989696` flips Stage Advancer → "Complete"
  when Claims Status → "Claims Paid", which chains into the move to Complete/Stuck
  (`7918291617`) **and** the Welcome Call item creation (`7918324247`). So the bot's
  "everything paid" write already advances patients out of DVS — no new automation needed,
  but see §3 for confirming the bot writes it.
- ℹ **Escalation at DVS behaves correctly:** `7918291647` moves escalated items to the
  Escalations group regardless of stage; the app's board-wide stage query still finds
  them, and the /dvs list + count exclude escalated patients consistently.

## 2. Medical Evaluation board — checks

- ☐ **Decide whether Approved-Stuck patients need a group move.** Approve Stuck writes the
  main Stage Advancer → "Stuck" (index 15), and **no automation on the board triggers on
  that value** (ℹ verified — it moves no group, sets nothing, and nothing ever overwrites
  it). Today the item stays in its working group and only the app's stage-based filtering
  hides it. If you want Stuck items visually parked on the board, add: "When Stage
  Advancer changes to Stuck → move item to [group]". App needs nothing either way.
- ℹ **Proposed Stuck (`color_mm5f37ve`) appears in zero automations** — the propose→
  approve flow is entirely app-side, nothing to sequence around on the board.
- ☐ **Supermail body mapping (pre-existing, still pending):** point the Supermail
  automation's email body at Request Message `long_text_mm4cnw52` (Workflow Center /
  Supermail panel; leave attachments unchanged), then run the end-to-end fax test from
  `monday-integration-spec.md`.

## 3. Railway bots (automate-dvs + friends)

- ☐ **CIN validation in the bot:** validate `^[A-Za-z]{2}\d{5}[A-Za-z]$` against Member
  ID 1/2 before running; malformed → Manual Review. Monday automations can't
  pattern-match, so the board edit in §1 will route no-CIN patients to DVS — the bot is
  the right place to catch them. (The app already refuses to route them on sends and the
  /dvs page shows a red warning.)
- ☐ **Confirm which webhooks the DVS services subscribe to.** Two active integrations
  (`583568221`, `583568251`) fire on **every** Stage Advancer change; dedicated webhooks
  exist for Trigger Supplies DVS (`595975096`) and Trigger Pump DVS (`607839558`). If the
  backend listens on the Stage Advancer webhooks, stage-DVS writes start real processing
  immediately — know this before flipping stages on live patients.
- ☐ **Confirm bot behavior against the v2 contract:** writes Stage → Complete only when
  every code's auth is approved AND claim paid (that's the §1 exit); manual review →
  Stage → Auth Denied + Escalation Required (manual review **outranks** the retry queue);
  retry-queue → no stage writes; re-runs (queue or manual) resubmit **only unpaid codes**;
  supplies DVS fires only after the pump claim is FULLY PAID when a pump step exists.
- ☐ **v2 bot rework (stage flip becomes THE trigger):** when it lands, delete the
  app-side trigger writes (`dvsAutoTrigger` + the task in `mondayWrite.ts`) and revisit
  the Re-run buttons' semantics.
- ☐ **Redeploy `baseline-cron` on Railway** with the 2026-07-21 rules (countDvs with
  snooze exclusion, stage-DVS exclusion from the three auth groups, Proposed Stuck
  exclusion, date-only Auth Outstanding bucket, Days Auth Outstanding recalc). Without it
  the Operations tab shows phantom drift all day. `DRY_RUN=1` to test.

## 4. Column contract (§10) — unlocks full per-code detail

- ☐ **Define + create the per-code DVS columns** on the Insurance board: per-code
  (E0784/A4230/A4232) auth result + error, claim result + error, paid amount; retry-queue
  state (attempt #, last run, **queue-entered date**); manual-review flag. Send the list
  and the SPA wires it (the /dvs page is structured to absorb them). Until then: the
  Retry Queue chart's x-axis is days-in-stage (not days-in-queue), the "cleared via
  queue" trail can't render, and E0784 claim detail is missing.

## 5. Decisions needed (people, not systems)

- ☐ **Brandon/Josh:** straight-Medicaid **pump DVS denied** handling; **CGM + Medicaid
  hybrid** (does supplies DVS wait on the CGM auth?).
- ☐ **Brandon:** eMedNY error classifier — which codes → manual review vs retry queue;
  **retry give-up threshold** (max attempts before flipping to manual review).
- ☐ **Janelle:** Auth Denial status definition ("manager working" vs "awaiting decision")
  to unlock the missing manager-view columns + Final Decisions actions (Can't Serve /
  retry benefits / stuck).
- ☐ **Janelle/Sam:** payer phone directory for the BCBS home-plan banners.
- ☐ **Josh:** should the `dvs` role be manager-only (like Oversight) or assignable?
- ☐ **Ops:** auto-escalate threshold for "Days Auth Outstanding" (`numeric_mm5f5ars`) —
  then it's a one-recipe Monday automation ("changes and is > N → Escalation Required").

## 6. Data cleanup

- ☐ **Delete the two fake DVS patients** before go-live: `DVS Test — Supplies Only [TEST]`
  (item `12593223717`) and `DVS Test — Managed Dual [TEST]` (item `12593254798`) —
  Insurance board, Complete/Stuck group, stage = DVS.

## 7. Not Monday, but gates the prod deploy (from CLAUDE.md §8/§10)

- ☐ Copy **every GitHub Actions secret** into the prod repo (`CLOUDFLARE_API_TOKEN`,
  `GH_PAT`, all `VITE_*` — especially `VITE_MONDAY_GATEWAY_URL` so prod runs through the
  gateway). Sync carries code only; missing secrets = silent blank/broken prod builds.
- ☐ Verify the bundled PAT has **write access to BOTH repos** (access.json + baseline).
- ☐ Worker `GMAIL_*` as **encrypted Secrets** (a wrangler deploy wipes plaintext vars);
  set worker `GOOGLE_CLIENT_ID` to pin the token audience.
- ☐ **Rotate the exposed RingCentral credential** (ships in the public bundle); confirm
  the RC app has the Read Messages scope.
- ☐ Longer-term (Phase 1b): stop bundling `VITE_MONDAY_API_TOKEN`/`VITE_GITHUB_PAT` in
  the public Pages build — the extractable Monday token is the audit's #1 risk.

---

## ⚠ Standing trap discovered in the automation dump (don't step on it)

**Any write to Stuck Reason `text_mm59w0e0` on the Insurance board instantly stucks the
patient**: automation `7920730503` flips Stage Advancer → "Stuck / Don't Proceed" whenever
that text column *changes*, chaining into the group move. There is no way to write it
"before the advancer" — the text write IS the trigger. The SPA currently never touches this
column (verified); keep it that way unless the intent is to stuck the item, and never add
it as sibling data to a verified-write transaction.
