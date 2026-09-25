## 7. Cross-cutting / manager views

- **Pipeline Oversight** (`/system-mgmt?tab=oversight`, `components/oversight/OversightTab.tsx` +
  `lib/oversight/oversightApi.ts`) — the manager dashboard. A **stage dropdown** (Intake · Medical
  Evaluation · Insurance · Welcome Call) renders one stage's charts at a time, bucketed by
  days-in-stage. **Manager views (2026-07-21, `MANAGER_VIEWS_DVS_BUILD.md`):** Medical Evaluation
  and Insurance use a 3-column scheme — Processor Overview / Manager Intervention / Final
  Decisions — rows aligned via `ChartDef.rowOf`. ME column 2 stacks **Attempt 4+** (MN Attempts
  `color_mm1wz0vg` = `"Escalate"` — the board has no literal "Attempt 4" label) with **3rd+ round**
  per stage (dedup: 3rd+ wins). ME column 3 = **Proposed Stuck** charts (keyed on Escalation
  `color_mm1x7997` **index 2** "Final Escalation Required"; the reason is extracted from the MN
  notes' stamped `[Proposed Stuck …]` line into a virtual `__proposedReason__` column) whose
  drill-down has the Oversight's first ACTION buttons: Approve Stuck (main Stage Advancer = Stuck,
  then clear the escalation — in that order) / Return to Queue (a modal that shows the MN notes,
  takes an OPTIONAL stamped note, sets Next Action Date = today, and clears the escalation so the
  patient re-enters the rep's queue). Every ME manager chart (incl. Proposed Stuck) opens the
  patient in the stage page (manager mode) to view/work in UI.
  ⚠️ **A return RESETS THE OUTREACH BUDGET, or the rep gets a patient they cannot work**
  (Josh, 2026-08-14; `lib/masheke/attemptRollup.ts` + tests, applied by `returnProposedToQueue`).
  Clearing the escalation is only half the job. **MN Attempts `color_mm1wz0vg` is what Confirm
  Receipt and Chase derive the current slot from — NOT which attempt columns are filled**
  (`currentAttempt` ← that column; `Escalate` ⇒ `isEscalated` ⇒ `locked = isEscalated &&
  !managerMode`, and `managerMode` is only ever `?manager=1`, which a processor's own role bar
  never sets). A returned patient therefore landed in the rep's sidebar, due today, counted in the
  burndown, showing a rose **"Escalated — all 3 attempts came back unsuccessful"** card *while the
  escalation had just been cleared*: notes editable, but no attempt, no fax/email re-send, no way
  to move the Next Action Date. They sat there forever. A **simulation across all six ME stages**
  (kept out of the repo; gates = queue · sidebar · role count · can-actually-work) found Evaluate,
  Confirm Receipt and both Chase roles dead on gate 4, and Doctor Appointments dead whenever the
  manager left the note box blank. The return now folds the spent attempt columns
  (`text_mm2yd068`/`mm2y9h4a`/`mm2ymtsk` · `text_mm2yhpjt`/`mm2yb3rv`/`mm2ybk06`) into the **MN
  Workflow Notes** under a dated header, blanks them, and writes MN Attempts back to **Attempt 1**
  (`MN_ATTEMPTS_INDEX.attempt1` = index **2** — this column's labels are not in numeric order).
  The counter reset is unconditional; the clears fire only when something was there.
  **Scope is per stage** (`returnAttemptReset`): `all` for Evaluate / Send Request / Confirm
  Receipt (the whole loop restarts from the top), **`chaseOnly` for the two Chase roles** — a chase
  return must NOT wipe the Confirm Receipt columns, because `ChaseClinicalsPanel` parses them for
  its "who actually confirmed receipt" banner. Doctor Appointments is `null`: it has no attempt
  columns, its counter is the attempt LINES in the notes.
  ⚠️ **The stamped `[Returned to queue …]` note is now written even when the manager leaves the box
  blank** (body defaults to "Returned by a manager", same as Patient Intake's
  `returnIntakeToPipeline` always did). That stamp is Doctor Appointments' **attempt-counter reset
  marker** (`apptOutreach.RESET_MARKERS`), so a note-less return used to leave three spent attempts
  counting and lock the rep out — silently, exactly as that module's own comment warns.
  ⚠️ **Append + clears ride ONE `change_multiple_column_values`** (all-or-nothing), so a cycle's
  notes can never be deleted without having landed in the history first — the same reasoning the
  rep-side re-eval rollup in `EvaluatePanel` carries, and both call `buildAttemptRollup` so the
  headers they write into that shared column can't drift. The escalation flip stays LAST and
  separate: it is what makes the patient visible to the rep, so it must not fire before the data.
  ⚠️ **`returnAttemptReset` is keyed by TWO vocabularies.** The stage page passes a `StageKey`, the
  drill-down passes the chart's `rowOf`, and the Email & Parachute chase is **`chase-parachute`** in
  one and **`chase-email-parachute`** in the other. A table holding one spelling doesn't error on
  the other — it returns null, the return looks like it worked, and the rep stays locked out. Both
  are listed and pinned by tests.
  ⚠️ This does **not** disturb the Attempt 4+ charts described below, despite their reliance on
  "MN Attempts is history, not a queue flag": those charts require escalation index 0, and a return
  clears the escalation, so a returned patient is off them either way. **Insurance columns 2/3 are
  REASON-BUCKETED (2026-07-29, `OVERSIGHT_CHART_RULES.md` §3):** the x-axis is one bar per reason
  (a patient can be in several bars; header count = distinct patients), driven by
  `ChartDef.reasonBuckets` + `reasonBucketsFor`. Column 2: Benefits (Inactive insurance · Pump SoS ·
  Check outstanding >5d — board facts, not the escalation label) and **Submit Auth** (the two DVS
  charts merged: DVS Retry · DVS Manual Review · Propose Stuck). Column 3 Benefits bars = arrival
  path (Propose Stuck stamp vs Universal Check columns); **Submit Auth column 3 mirrors column 2's
  three bars one rung up** and **Auth Outstanding column 3 has a single Propose Stuck bar** (both
  2026-08-02 — before that they were day-bucketed, which said nothing a manager could act on).
  **A chart's population is its `CHART_FILTERS` rule UNION its bars** (`patientMatchesChart`,
  2026-08-03). That union is what lets `submit-auth-manager` / `submit-auth-final-escalation` carry
  a "Submit Auth." stage rule at all: two of their three bars are stage-**DVS** patients, which a
  chart-level rule alone would filter out, so the rule can only ever ADD. `handlePatientClick`
  still overrides the route per patient (DVS rows → `/dvs`).
  ⚠️ **Every escalated patient must land in some manager chart** — an escalation removes them from
  the rep's queue AND from the role count, so a state that matches no chart is invisible in the
  whole app. Bars key on board FACTS and escalations are LABELS, so the two drift; each Insurance
  manager chart therefore carries a population rule wider than its bars. **Benefits and Submit Auth
  have both rungs; Auth Outstanding has ONLY Final Decisions** (Josh, 2026-08-03 — an escalation at
  that stage should only ever land in Final, so the `auth-outstanding-manager` chart built earlier
  that night was removed). Because that leaves one chart to catch everything, its population rule
  takes **either** escalation index (0 or 2) — nothing in the SPA writes Manager there any more
  (`authOutstandingOutcome` → `final` on the pump-SoS hold, `proposeStuckLevel` → `final`),
  but a label carried in from an earlier stage or written by one of
  the four DVS/claims automations would otherwise be invisible. Its two bars (**Pump SoS** ·
  **Propose Stuck**) match either rung for the same reason — deliberately unlike the Submit Auth
  pair, which splits on level so a promoted patient leaves the lower chart.
  **`authDenied` is the one deliberate exception (Josh, 2026-08-03): the stage is under
  construction — do NOT build UI for it.** It has no manager charts at all, and since ANY denial
  escalates those patients are worked on the board until the stage is built; don't "fix" this. (The
  Auth Outstanding send still writes **Manager** on a denial — the patient leaves for that unbuilt
  stage, so choosing Final would pre-judge a design nobody has done.) Manager
  Intervention decision buttons are the intent on every row except a bot-owned DVS one — a row a
  manager can see but not clear is still a stranded patient.
  ⚠️ **In practice only 2 of the 9 Manager Intervention charts carry them** (audited 2026-08-14):
  `submit-auth-manager` and `profile-send-off-unverified-escalated`. `benefits-manager-escalation`,
  all five ME `*-escalated-merged` and `doctor-appointments-manager` have **no `decision`**, and the
  drill-down renders its buttons from `ChartDef.decision` alone — so those seven offer no inline
  Return to Queue. Nobody is stranded (every one routes to the stage page with `?mv=`, where
  `StageActionBar` does offer Send back to pipeline), but it is an extra hop and the asymmetry with
  Final Decisions — where **every** chart has a decision — is not deliberate. `lib/oversight/insuranceCoverage.test.ts`
  enumerates the reachable (stage × escalation) states and fails if one goes blind (Auth Denied is
  carved out by name, and Auth Outstanding's Final-only shape via `FINAL_ONLY_ROWS` — both asserted
  as carve-outs); `lib/samantha/managerRail` mirrors these populations for the destination page's
  sidebar — change the two together.
  ⚠️ **The three columns must PARTITION the stage — nobody in two, nobody in none** (Brandon,
  2026-08-12). `insuranceCoverage.test.ts` guards the "none" half; `lib/oversight/
  columnExclusivity.test.ts` guards the "two" half, over ME · Insurance · Intake, from the real
  chart defs. Medical Evaluation had the second failure for as long as the manager views existed:
  its Processor Overview charts excluded escalation index 2 but **not index 0**, so 20 escalated
  patients (the reported one) were counted in the processor column AND a manager
  column, while being absent from the rep's sidebar and burndown — the processor bar was showing
  work nobody was doing. All five now exclude **[0, 2]**, matching Insurance and Doctor
  Appointments. Two consequences that must move together: the `*-escalations` ("Attempt 4+")
  filters now require index 0 (**MN Attempts is history, not a queue flag** — Return to Queue
  clears the escalation and deliberately leaves it set, which used to strand the patient on both
  bars), and each `*-escalated-merged` chart gained a **population rule** (stage + index 0) unioned
  with its two series, because the series don't cover every route to index 0 and Processor Overview
  no longer catches the remainder. `StackedStageChart` footnotes those as **"+N other escalation"**
  and lists them in the drill-down. **Insurance got the same treatment the same day**: the Benefits
  Manager Intervention bars *Inactive insurance* and *Pump SoS* keyed on the board FACT with no
  escalation condition (Katie/Josh, 2026-07-29), which put a non-escalated patient in two columns —
  and worse, made the row **uncleanable**: Return to Queue drops the label and hands the patient
  back to the rep, but the insurance is still Inactive, so they stayed on the manager's bar forever.
  All three bars now require Escalation index 0. Nothing is lost by that, because **every one of the
  three facts already writes the label**: `universalEscalationLevel` → manager for Inactive;
  `deriveInsuranceOutcome` → `blocker` for a not-clear pump (`workflow.ts`), which
  `mondayWrite` turns into manager when no universal check failed; and board automation
  **7921298383** for the days bucket. A fact set directly on the board without a label leaves the
  patient in Processor Overview — visible, and the rep's.
  ⚠️ **Do NOT add a Monday automation on the Not Clear Products dropdown** to "cover" the pump
  case. Monday cannot express *dropdown contains Insulin Pump* — the only trigger available is the
  whole column changing, which would escalate a patient whose CGM Sensors came back Not Clear, a
  case `deriveInsuranceOutcome` deliberately does NOT treat as a blocker. The app write is exact.
  **The DVS page edits DOCTOR details and downloads clinicals** (2026-08-12). It stays a
  read-only *monitor* of what the bot did, but the doctor block on `samantha/PatientProfileCard`
  is editable there — all eight columns (name · Clinicals Method · NPI · phone · fax · email ·
  clinic · clinic address, `COL.clinicAddress` added then) — plus `ClinicalsDownloadButton`. The
  card takes **`editScope="doctor"`**, which leaves identity + insurance read-only: those are the
  inputs the whole rail derives from, and the Stedi argument below applies unchanged. Edits go
  **straight to the board** (this page has no overlay and no Send), batched behind the card's Save
  — its inputs fire on every keystroke, so a per-change write would be a dozen board writes per
  name. ⚠️ `writeEmail`/`writePhone` **skip** a value they can't parse rather than throwing, so
  `unwritableDoctorFields` checks the draft BEFORE the first write — otherwise a typo'd fax saves
  green having written nothing (§10's optimistic-UI trap), or leaves a half-saved record.
  ⚠️ **There is NO Escalate toggle in the Insurance UI — don't reintroduce one** (Josh,
  2026-08-03). The only escalation affordance is the **Propose Stuck popup**, plus the manager
  decision buttons and the board automations. `components/samantha/EscalateButton.tsx` had zero
  importers and was deleted (Welcome Call / Final Confirm / Subscription keep their own copies in
  their own folders — those are live; masheke's is commented out).
  **A send therefore writes the Escalation column only when an AUTO rule decides one**
  (`samantha/mondayWrite.autoEscalationWrite`): the Auth Outstanding pump-SoS hold → Final, a
  denial → Manager, and an auto rule only ever RAISES. Otherwise the column is left exactly as the
  board has it. Submit Auth has no auto rule at all, so its sends never touch escalation — that is
  what keeps a rep's Propose Stuck at Manager until a manager actually reviews it.
  This replaced a "manual toggle is the floor" rule that read `p.escalated` — which is **hydrated
  FROM the board** (`mondayMapping`, index 0/2), not from any control — and re-wrote it on every
  send. It silently PROMOTED (a pending Submit Auth proposal jumped to Final, skipping the review,
  with no note) and silently CLEARED (a flag raised since the page last polled got overwritten with
  "Done", dropping the patient back into the rep's queue with nobody told).
  **Benefits is the deliberate exception** and still writes unconditionally, "Done" included:
  escalation there is DERIVED from the universal checks (redesign §5), so clearing it by fixing the
  facts and re-sending is the design.
  **A manager who works the patient RESOLVES them** (Josh, 2026-08-03) — the one case besides
  Benefits where a send writes the column with no auto rule. The three Insurance stage pages pass
  `managerResolve: isManager` to `sendPatientToMonday`, so Benefit Check Complete / Auth Submission
  Complete / Auth Review Complete clear the escalation and hand the patient back to the pipeline
  rather than leaving the label that put them in the manager column. It does NOT reintroduce the
  toggle above: this is an explicit act by the person the escalation was raised FOR, keyed off
  `?manager=1`, not a hydrated flag re-written on every send — and the auto rules still run after
  it, so a review that comes back denied re-escalates on the NEW facts.
  `components/samantha/ManagerResolveNote` says so on the page whenever `?manager=1`, because it
  can't be undone from there. Manager Intervention's **Send back to pipeline requires a note** (the
  return clears the escalation and the row vanishes, so the stamped note is the only thing the rep
  ever sees); Final Decisions' return stays optional.
  **The escalation ladder is processor → Manager Intervention → Final Decisions**
  (`stageActions.proposeStuckLevel`, 2026-08-02): Propose Stuck writes one rung UP from wherever
  the patient already is — an existing escalation label OR a click from Manager Intervention
  promotes to Final; otherwise Submit Auth and DVS start at Manager and Benefits / Auth
  Outstanding go straight to Final. It used to key off the STAGE alone, which made a manager's own
  Propose Stuck a no-op at Submit Auth (it rewrote the label the patient already had). The
  drill-down's "Escalate to Final Decisions" button still exists as the other route up.
  **Both DVS bars are escalation-split**: Manager Intervention excludes Final, Final Decisions
  requires it — reversing the 2026-07-29 "status-only" rule, which was correct only while nothing
  ever wrote an escalation onto a DVS patient. **Four board automations now do** (all active
  2026-08-02), one per rose column, each ⇒ Escalation = Manager Escalation Required:
  **7918444697** Trigger Supplies DVS `color_mm26pk1a` ∈ {Failed, Manual Review, MLTC} ·
  **7921430568** Trigger Pump DVS `color_mm578kbd` ∈ {MLTC, Failed, Manual Review, Denied} ·
  **7921431002** S Claims Status `color_mm284z0b` and **7921431140** IP Claims Status
  `color_mm5g8085`, both ∈ {Claims Error, Claims Denied, Payment Incorrect}. Those label sets are
  exactly the `dvs-manual-review` CHART_FILTER's `anyCols` — **keep the four automations and that
  filter in agreement**, or a patient escalates into a chart that can't list them.
  **The board splits claims in two** — `S Claims Status` (supplies) and `IP Claims Status` (pump),
  each with its own paid-amount / paid-date / denial-reason / error columns. The **IP half was
  unread by the entire SPA until 2026-08-02** (no `COL` entry, so a pump claim failure classified
  as nothing); it now flows through `COL.ipClaims*` → `Patient` → both DVS chart filters,
  managerRail and DvsPage's `isManualReview`, and renders as an "Insulin pump claim" block on the
  DVS claims card so the manual-review reason is visible.
  `DvsPage`'s `pumpClaimPaid` ("has the pump claim paid, so supplies may submit?") reads
  `dvsRouting.pumpClaimStatus`, which **prefers `ipClaimsStatus` and falls back to the shared
  `claimsStatus`** while the pump column is blank — every patient today. So it needs no edit when
  the bot starts writing the pump column. Being wrong there is cosmetic by design: it only picks
  the Supplies card's "Waiting on pump" chip, while a pump claim that actually FAILS is caught by
  `isManualReview` + the escalation automation off the raw status columns, which never consult it.
  **Manager Intervention has "Send back to pipeline"** (`returnToQueue`, optional stamped note →
  clears the escalation + re-dates to today) — an escalated patient is invisible to the rep, so
  this is the only way back and it previously existed only in Final Decisions.
  **DVS × Final Decisions additionally gets "Send back to manager"** (`returnToManager` →
  `returnInsuranceToManager`, Final → Manager index 0): the final reviewer fixes the run on the
  board and hands it back to the manager who watches DVS, rather than dropping it to a rep who has
  no DVS actions. That is the only Final→Manager transition; everything else raises or clears.
  Benefits auto-escalation splits by cause: OON / Medicare-not-primary / DME-no → Final, Inactive
  alone → Manager (`universalEscalationLevel`). `lib/oversight/priority.ts` adds
  VIP/priority scoring (localStorage config). The open drill-down `{stage, chart, bucket}` is
  **mirrored to the URL** so Back from a patient's agent page returns to the exact drill-down (see the
  back-nav note in §9). **Keep oversight reads on the gateway:** `oversightApi.ts` must route through
  `MONDAY_API_URL`/`mondayIdentityHeaders` from `shared/mondayEndpoint`, *not* hardcode
  `api.monday.com` (a handoff once regressed this — reads would then bypass token-injection + audit).
  **`BenefitsPatientHeader` is read-only for EVERYONE — including managers (2026-08-02).** A
  manager-only "Edit profile" dialog lived there from 2026-07-30 (Serving · Primary/Secondary
  Insurance · Member ID 1/2, gated to the escalation columns) and was removed, along with
  `lib/samantha/managerIdentityEdit`, `saveManagerIdentityEdits`, samantha's `fetchStatusOptions`
  and `isManagerEscalationView`. **Don't rebuild it without solving the Stedi half** (Josh): those
  five facts are only half a correction — changing the payer means re-verifying eligibility, and
  the Insurance board cannot run a Stedi check. It has **no Run-Stedi trigger column**, **neither
  eligibility input column** (General Insurance `color_mm24ap4j` and the working Member ID
  `text_mm4t8gbq` are Profile-Send-Off-only; Insurance's Primary Insurance is a different column
  with a different vocabulary), and only ~9 of the 33 Stedi result columns — missing both terminal
  signals (Eligibility Active?, Error Description) plus Managed Medicaid / Medicare Advantage /
  Medicaid ID, which drive the banners, `isCoverageActive` and the serving suggestion. The Railway
  `stedi-monday-integration` service is bound to one board's schema (single `ELIG_COL_*` set; its
  board list has no Insurance board), so this is board **and** backend work, not a UI change.
  Corrections go back through Profile Send-Off instead.
- **System Management** (`/system-mgmt`, `lib/systemMgmt/mondayApi.ts`) aggregates counts/pipeline
  across *all* boards (hardcoded board + stage-advancer column IDs); `OperationsTab` + `PipelineChart`
  render burndown and day-bucket distributions.
  **Search is LIVE — it asks Monday per query and never answers from a snapshot** (2026-09-03,
  `mondayApi.searchPatientsLive` + `hooks/systemMgmt/useLiveSearch`). Until then the box filtered a
  browser-side copy of all seven boards: a 15–20s cold download (Profile Send Off alone is 2,635
  items in six sequential 500-item pages, ~680 KB each with notes), repeated every 90s, fronted by an
  IndexedDB snapshot up to **24h old** — so the first seconds of every visit searched yesterday's
  boards. Katie stopped using it and looked patients up on Monday instead. Now each debounced query
  is ONE aliased request across all seven boards with `contains_text` rules — name by WORD, ANDed
  (so "doe, jane" finds `Jane Doe`), or the phone column by digit substring — measured at
  **200 complexity vs 16,020 per full page**, sub-second, and re-run silently every 45s while a
  query is on screen. Latest-wins (older in-flight requests are aborted and their answers dropped);
  a failure says so rather than substituting older rows — and the invalidation happens on the
  keystroke, BEFORE the debounce, or an answer to the previous query landing inside those 300ms
  would paint under the new one (Greptile, PR #53). Name terms are trimmed of edge punctuation so
  "Delgado, Jose" reaches Monday as `Delgado` + `Jose`. ⚠️ The Search tab is **exempt from the
  page's LoadingState/ErrorState gates** — those belong to the seven-board snapshot, which survives
  ONLY for the pipeline chart, the totals and the other tabs, and whose banner now says exactly that.
  The fuzzy subsequence match ("jsoe") is gone by necessity; substring and word matching remain, and
  `rankLiveResults` orders what Monday returned WITHOUT dropping rows the local ranker can't score
  (`searchPatients` would). Same `searchColumnIds`, same `mapToSystemPatient`, so a row is identical
  whichever path produced it.
  ⚠️ **`searchedQuery` is the TRIMMED query, and two screens depend on it** (2026-09-24). System
  Management and the Comms Hub's `DossierSearch` decide "has THIS query been answered?" with
  `searchedQuery === query.trim()`, but the hook stored the raw text — so a name typed or pasted
  with a space on either end never counted as answered, and with the open folder empty the page sat
  on *"Searching all boards for …"* with a spinner for ever although Monday had answered in a
  second (Janelle: a nickname that matched nobody, whose honest answer was "No patients found").
  `useLiveSearch` now runs on the trimmed text throughout — request, refresh, `searchedQuery` — and
  a stray space is not a new query. Pinned by `useLiveSearch.test.tsx` + `pages/systemMgmtSearch.test.tsx`.
  ⚠️ **A NAME QUERY THEN ASKS AGAIN BY THE NUMBER — because a patient is not the same string on
  every board** (Josh, 2026-09-11). Augustina Rodriguez (DTC Intake · Profile Send Off · Medical
  Evaluation) and Agustina Rodriguez Hernandez (Subscription since April · Secondary Claims) are ONE
  patient: same phone `4062237445`, same DOB `08/28/1956`, five items, two spellings — a one-letter
  first-name typo and a Spanish double surname recorded on some boards and not others. Rules are
  `contains_text` **ANDed per word**, and a `contains_text` is a contiguous substring, so "Augustina"
  is not inside "Agustina…" and "Hernandez" is not inside "Augustina Rodriguez": **no name query can
  return both halves**, and the rep searching either one is told, accurately, about half of her.
  So `searchPatientsLive` runs a SECOND aliased pass keyed on the phone numbers the first pass
  returned (`sameNumberNeedles` → `phoneRulesLiteral`, the same literal the typed phone query uses),
  merges what is new (`mergeSameNumberRows`) and marks it `matchedBy: "phone"`; the page renders
  those under their own **"Same phone number, filed under a different name"** heading, because a row
  carrying a name nobody typed reads as the search misfiring rather than as the record it went and
  found. It works in both directions — either spelling finds the other.
  ⚠️ **The cap is the whole safety property.** Above `SAME_NUMBER_MAX_PHONES` (3) distinct numbers
  the pass is SKIPPED: "Rodriguez" returns forty rows carrying forty numbers — forty people, none of
  them the one being looked up — and fanning out on those spends a request per board to say nothing.
  Three or fewer means the query has already narrowed to a person. A row with a blank phone
  contributes nothing and does **not** count against the cap, or one board returning a blank quietly
  switches the whole pass off. ⚠️ A failed second pass is swallowed (an abort still propagates, or
  `useLiveSearch`'s latest-wins breaks): the name answer is the answer this search gave until today,
  so degrading to it costs the extra rows and never the search. Two round trips and ~400 complexity
  instead of 200, only on a name query — a phone query has already found everyone on the number.
  ⚠️ A number genuinely shared by two patients (18 of 3,140 on the live boards, §5.28) surfaces the
  household under that heading. That is the heading's job; do not "fix" it by narrowing to one name.
  `sameNumberSearch.test.ts` holds the five live records as its fixtures.
  **Results are FOLDERED — Active · Completed · Stuck · Orders** (`lib/systemMgmt/searchBuckets.ts`
  + tests; Orders joined 2026-09-15, §5.35). A patient is one item per board (§6), so one name returns three to five rows — the
  finished Profile Send Off record, the finished ME record, the live Insurance record — and in a
  flat list a rep clicks the first row carrying the name: "Search shows the wrong profiles".
  `searchBucket`: Completed group ⇒ **completed** (checked first, as `profileStatus` does); a
  `STUCK_GROUP_IDS` group OR an EXACT Stage Advancer label from `STUCK_ADVANCER_LABELS` ⇒ **stuck**
  (the label is written before the automation moves the item; the list is read off the live
  `settings_str` — DTC Intake's MASTER STAGE says "Stuck Final Review" and **"Can't Proceed"**, so
  a `^Stuck` pattern would have missed one and over-matched elsewhere; Greptile caught the pattern on
  PR #53) OR **Proposed Stuck** (Escalation index 2, awaiting Final Decisions — Josh, 2026-09-03,
  pointing at a stuck patient on that screen: *"stuck patients absolutely do have a UI"*; to the
  manager this search serves a proposal and an approval are one queue, and the Profile Status badge
  still tells them apart) ⇒ **stuck**; everything else ⇒ **active** — Manager Intervention (index 0)
  included, since that patient is being worked, by a manager; and **orders** — every New Order Board
  row and nothing else, checked before all of them (§5.35). Defaults to Active; an empty folder
  names the others' counts rather than saying "no patients found", which is also how a rep discovers
  the Orders folder: search a name, be told where the rows are. Chart picks and stage filters go
  through the same folders — and show an empty Orders folder, correctly, because those come from the
  snapshot and the order board is not in it.
  ⚠️ **A digits query is a phone search on every board but the ORDER board**, where it also matches
  the CAH number, the PO number and all five tracking numbers (§5.35) — so a tracking number lands in
  the Orders folder while Active reads empty, and the "Found in:" line is the route to it.
  **Search is a MANAGER's tool, so a row opens the OVERSIGHT screen for that patient** —
  `lib/systemMgmt/searchOpen.ts` `searchOpenUrl` (+ tests), one rule for every click: a finished
  record → its review page (`?completedStage=`); **stuck or Proposed Stuck → the stage page as Final
  Decisions** (`?mv=final-decisions&manager=1`, Approve Stuck / Return to Queue on the action bar);
  escalated → Manager Intervention (`?mv=manager-intervention&manager=1&escalated=1`); ordinary work
  → the plain stage page. ⚠️ Those params are `OversightTab.handlePatientClick`'s contract, read by
  every stage page via `lib/shared/managerOrigin` — keep the two writers aligned or the same patient
  opens two different screens. ⚠️ An item parked in a **Stuck GROUP** has `roleRoute ""`, so it
  falls back to the board's canonical page from `COMPLETED_STAGE_ROUTES` (Evaluate · Benefits ·
  Welcome Call · Profile); the pages inject a deep-linked `?patientId=` whatever group it sits in.
  Stuck rows on DTC Intake / Secondary Claims / Subscription have no canonical page and stay notes.
  `MASHEKE_STAGE_ROUTES` gained `Doctor Appointment → /doctor-appointments` the same day — Search
  had been sending that sub-stage to /evaluate while Oversight sent it to the outreach page.
  **The row leads with the STAGE** (Josh, same day: *"we need the person's stage — like Medical
  Necessity or Insurance · Auth Outstanding — more clear from here"*): its own 210px column with a
  board-coloured left bar (`BOARD_TONE`), the board as a manager says it (`BOARD_STAGE_LABEL`:
  "Medical Necessity", not "Medical Evaluation") in small caps over the stage in the largest type on
  the row, the group beneath when it differs. Notes keep the flexible middle. The stage text still
  filters the list to that stage.
  **A row with no page is a NOTE, not a profile** (Josh, 2026-09-03, same day: *"it shouldn't show a
  profile unless we have a UI for it … but if it is in an inaccessible board have a note that says
  patient is in the system but not on a workable page, check Monday — and have it say what and where
  it is"*). `searchOpen.rowIsWorkable` = `searchOpenUrl(row) !== null` — a live stage page, a
  finished record's review page, or a stuck patient's Final Decisions view. Everything else (every DTC Intake and Secondary Claims
  row, Subscription "Not Active Patients", Profile Send Off "Patient Intake"/"Tests", any item parked
  in a Stuck group) renders as `UnworkableRow`: name · *is in the system but not on a workable page —
  check Monday* · board · group · stage · phone, with nothing to click. Workable profiles lead and
  are **highlighted** (`PatientRow highlight`) whenever notes follow, under a divider label — the
  Josh Hoffman search that prompted this had one Subscription row buried under eight dead rows. Not
  hidden, deliberately: "not found" would be a lie about a patient we can see, and the note tells the
  rep where to go instead.
  ⚠️ **Search reads EVERY group on EVERY patient board — never add a group filter** (2026-08-12).
  `BOARDS[].groupRoutes` is navigation metadata ("clicking this row goes where"), **not** the fetch
  list; `fetchBoardItems` queries `items_page` unfiltered. It *was* the fetch list, and every group
  added to a board afterwards went invisible with no error: Insurance's **DVS** group (the reported
  bug) and its Stuck group, Profile Send Off's **Already In System** + two New Form groups + Stuck,
  and the Stuck group on ME and Welcome Call. Two whole boards were missing too — **DTC Intake**
  and **Secondary Claims** — so ~1,250 patients the app works were unfindable. This is the §5.10
  bug class: a list that must be updated when a board changes will not be. Search is the one place
  in the app with no queue rule, and `searchCoverage.test.ts` asserts the board set.
  A group missing from `groupRoutes` is still searched; it just isn't clickable (`rowRouting`
  returns route `""`). ⚠️ That default used to be **`/`**, which sent a rep to the app's home page
  as if the click had worked. `rowRouting` also lets the **Stage Advancer win over the group**, so a
  stage-DVS patient parked in the Benefits group opens `/dvs` — matching the rule `useRoleCounts`
  already uses (§5.8), rather than the one queue that deliberately excludes them.
  **Search's green completion badges are LINKS into the finished stage** (Aug 2026,
  `lib/systemMgmt/stageCompletion.ts`). **This is also the app's stage-history mechanism — see §5.38
  before anyone proposes storing snapshots on advance.** A patient is a different item on every board (§6), so
  `buildCompletionMap` — name-keyed, because that's all the boards share — now carries each
  completed item's own **id + board**, and the badge opens THAT item on the page that gathered the
  data (`COMPLETED_STAGE_ROUTES`: Profile → `/profile`, MN → `/evaluate`, Insurance → `/benefits`,
  Welcome Call → `/welcome-call`), via `?patientId=<completed item>&completedStage=<boardId>`.
  Every role hook already injects a deep-linked `?patientId=` that isn't in its queue, so the
  completed record loads with no hook changes. A **completed row opens its own record too**
  (`completedStageForPatient`) — `hasPage` is false for anything in a Completed group, so those
  rows used to dead-end on a "no dedicated page yet" toast. Search rows are **tagged
  COMPLETED (green-tinted row) / ACTIVE**, and a completed row's days-in-stage chip drops the
  urgency colour: it's a frozen number, and a red "30+ Days" inside a finished record reads as
  work nobody is doing.
  ⚠️ **`completedStage` is a WRITE GATE, not just a banner flag.** `useCompletedStageReview`
  (`components/shared/CompletedStageBanner`) drives `reviewMode` on those four pages, which
  disables the stage-advancing send (`EvaluatePanel` `sendBlocked`, `BenefitsPanel`, Welcome
  Call's `SendToMondayButton`, Profile's two send-off routes). Without it a rep reading history
  could re-advance an item that already moved on — the advancer is what board automations key on,
  so it would move a finished patient back into the pipeline. Notes/inline saves are deliberately
  still live (harmless, and sometimes wanted). It is gated on the **selected patient**, not the URL
  alone: `?patientId=` survives a sidebar click, so keying only off the URL left the banner and the
  lock sitting on the next LIVE patient the rep opened.
  **"When was it completed" comes from the ACTIVITY LOG** — no board has a completion date column.
  `completedAtFromLogs` takes the latest of (move into the board's Completed group) and (the
  board's own completion status write — Insurance says `Complete`, Welcome Call/ME `Completed`,
  Profile Send Off exits via `Move to Onboarding` = `Advance to MN`). Both signals are needed:
  a batch move logs no `move_pulse_*` event at all. ⚠️ `created_at` there is **100-ns ticks, 17
  digits** — reading it as ms lands ~50,000 years out, which renders as a plausible date rather
  than an obvious bug. Monday prunes activity by plan retention, so the lookup can come back empty
  and the banner must say "date unavailable" rather than guess.
  **WHO completed it comes from the GATEWAY's audit log, not Monday** (`services/monday-gateway/
  stageActor.mjs` ← `lib/systemMgmt/stageActor.ts`). Every SPA write carries the same Monday API
  token, so the board's activity log names one service account for all of them — `gql_log.actor`
  (the signed-in email, §5.1) is the only place the person exists. `GET /audit/stage-completion
  ?item=&at=&column=` takes the completion instant computed above and picks the mutation that wrote
  the advancer, falling back to the latest attributed write in a −30min/+2min window (a send is a
  transaction, not an instant) flagged `matchedColumn:false`. **No auth gate** — same posture as
  `/gql` and `/send`: auth is enforced once at the website's sign-in gate, and anyone working in
  the Command Center sees who did what like any other fact the app shows them (Josh, 2026-08-12 —
  a per-request 401 was tried and removed; don't re-add one).
  `actor_verified` is **NULL on the /send path**, i.e. on most real
  completions, so the banner shows the email either way and puts the provenance in a tooltip —
  the flag says how the attribution was obtained, not whether it's plausible. Direct (no-gateway)
  builds have no audit log at all: `stageActorConfigured()` is false and the name is simply omitted.
  **The Escalations tab** (`?tab=escalations`) is a filter over the same cross-board fetch as
  Search — **not** a group, and not its own query. Membership is ONE status column per board
  (`BoardDef.escalationColId`): ME + Welcome Call `color_mm1x7997`, Insurance `color_mm2vsh2f`,
  matched by exact label OR — on the two split boards only — raw index 0/2, so a rename can't
  blind it. The other four boards have `escalationColId: null`, so **nothing on DTC Intake,
  Secondary Claims, Subscription or Profile Send Off can ever appear there**. The Monday groups
  literally named "Escalations" are irrelevant to it.
  ⚠️ **The reason lives in the NOTES column, never in an escalation column** (rebuilt 2026-08-14,
  `lib/systemMgmt/escalationDetail.ts` + tests). The tab used to describe an escalation from a
  per-board **Escalation Notes** long_text parsed for a `[ESCALATION FORM]` block
  (`lib/shared/escalation.ts`). Audited against the live boards that column held data for **3 of
  58** escalated patients: the Details modal said "no escalation form data found" for 35 of the 38
  that reached it, and since `parseEscalation` returned null the row colour fell through to its
  `"Medium"` urgency default — **every row in the tab rendered the same yellow, the colour-coding
  had never once fired.** Escalations are raised two ways today and neither writes that column:
  **Propose Stuck** stamps the reason into the stage's notes (`lib/masheke/proposedStuck.ts`), and
  the **auto rules** (attempt 4+, days outstanding, a denial, the four DVS automations) write the
  status and nothing else. So a patient with no stamp is NORMAL, not missing data — their attempt
  log is the explanation, and reporting it as absent is what made the tab useless. Row colour and
  the badge are now the **rung** (`escalationLevel`, orange = index 0 Manager Intervention, red =
  index 2 Final Decisions, `flat` for Welcome Call which never split) — derived from the same
  inputs as the membership flag so the two can't disagree. The legacy form block is still rendered
  when present, so the three patients carrying one lose nothing.
  ⚠️ Its **Remove** button is still the blunt one — Escalation → Done + Next Action Date = today,
  with **no stamped note and no attempt reset**, unlike Oversight's `returnProposedToQueue`
  (§7 above). Known gap, deliberately left; don't assume clearing here leaves the same trail.
  ⚠️ The retired **`EscalationFormModal`** was **deleted on 2026-09-14** together with the two
  `EscalateButton`s that opened it: Welcome Call and Final Confirm run the Propose Stuck ladder now
  (§5.34), and the four ME pages' commented-out mounts lost their dead import lines with it.
  `lib/shared/escalation.ts` stays for this tab's legacy `[ESCALATION FORM]` parse.
- **Communications is a System Management TAB** (Josh, 2026-09-10) — the same
  `AssignedPatientsPage` hub as `/assigned-patients` (§5.28), rendered with an
  **`embedded`** prop. That prop does exactly two things: it stops the page
  claiming `h-screen`, because the host owns the layout, and it drops the **back
  button alone** — the host's own header sits 45px above with a back button that
  goes to the same place.
  ⚠️⚠️ **THE HOST MUST THEN GIVE IT A DEFINITE HEIGHT — `h-screen overflow-hidden`
  on the Communications tab, never the page's ordinary `min-h-screen`.** The hub's
  three panes are `flex-1 min-h-0` and scroll internally, and `min-h-0` can only
  bound a parent that HAS a definite height. Under a minimum the flex row's height
  is auto, so the conversation list grows to fit every row: with the live inbox
  (732 conversations) the document ran ~48,000px tall, and both the message
  **composer** and the profile pane's `justify-center` **spinner** landed thousands
  of pixels below the fold. Reported as *"there's literally no bar to send a text
  at the bottom"* and *"no loading animation for command center profile as well"* —
  one cause, two symptoms.
  ⚠️ **IT ONLY REPRODUCES WITH VOLUME, and that cost a wrong verdict.** Measured in
  a browser at 1440×900: 800 conversations under `min-h-screen` ⇒ document 48,063px,
  composer at y=47,993, off screen; under `h-screen` ⇒ 900px, composer at 830. With
  a **two**-conversation fixture the content fits inside 100vh, `min-h-screen`
  stretches the child to exactly the same layout, and the two are pixel-identical.
  This fix was made, "disproved" against that thin fixture, reverted, and re-made
  from a user screenshot showing the page scrolled past its own header. Any re-test
  of this needs a long list; `systemMgmtTabs.test.ts` pins the class name.
  ⚠️ **EVERYTHING ELSE RENDERS IDENTICALLY, navy bar included** (Josh, same day:
  *"exactly the same"*). The first cut also restyled the header into a plain white
  strip and dropped the icon and the "Communications" title, leaving a dialer and a
  bell floating on white — a working screen that read as half-built. **Restyling a
  header is not a cheaper way to say "this is embedded"**: the three-pane hub is
  the whole content, so its chrome is the only thing telling a rep the view is
  finished. `systemMgmtTabs.test.ts` pins the parity (navy, icon, title, and no
  `embedded` branch inside the header but the back button).
  ⚠️ **Mounted CONDITIONALLY, never hidden.** Every RingCentral poll in the hub
  is scoped to its mounted tab (§5.28's "only the OPEN tab polls"), so a
  `hidden`/`display:none` toggle would poll the shared account from a screen
  nobody is looking at — INCIDENT_2026-08-20's shape, and invisible on this page.
  ⚠️ It renders as a flex CHILD of the page shell, outside `<main>`'s scrolling
  max-width column (the same reason Oversight widens to `max-w-full`, one step
  further), and is `lazyWithReload`-imported so the tab nobody opened costs
  nothing. `systemMgmtTabs.test.ts` scans for all of it — verified to fail when
  the conditional mount is replaced by an always-render.
- **The tabs sit INLINE in the header, centred** (Josh, 2026-09-15: *"i wanted search communication
  stage manager and operations centered to save space at the top"*). They used to occupy their own
  ~45px strip under the title row, left-aligned with the right half empty; merged and centred, the
  page gets that strip back — measured 64px of chrome against ~135px, which matters most on the
  Communications tab where the hub adds a third band of its own.
  ⚠️ Centred by giving the OUTER groups `flex-1`, **not** by absolutely positioning the middle one:
  equal flex basis centres it while the title and Refresh are different widths, and a narrow window
  makes it SQUEEZE rather than draw on top of its neighbours. Below `lg` it wraps to its own centred
  row (`w-full justify-center`), so nothing is ever clipped or stacked — measured 89px wrapped,
  64px inline at ≥1440.
  ⚠️ `TabBtn` became a PILL: the old `border-b-2 -mb-px` underline anchored to the header's bottom
  edge, and inline in the row it drew a stray line through the middle of the bar.
- ⚠️ **The Escalations tab is COMMENTED OUT, not deleted** (Josh, 2026-09-10) —
  the `TabBtn`, the `EscalationView` body and the header's escalation-count chip.
  Everything behind them stays wired (`useSystemPatients`' `escalated`,
  `removeEscalation`, `EscalationDetailModal`, the `Tab` union member), so
  restoring it is uncommenting two blocks. The chip went with the tab because it
  was never clickable: with no tab to open, it advertises a number this page can
  no longer show anybody. Escalations are worked in **Oversight's manager
  columns** (§7). ⚠️ `?tab=escalations` deliberately falls through to **Search**
  — a stale bookmark or a Back into that URL would otherwise select a tab with
  no button and no body, i.e. a blank screen with no way out.
- **Patient Questions** (`/patient-questions`) is an inbox merging "patient message" columns from
  the Subscription + Secondary Claims boards. **Mark completed** stamps a "Question Handled At"
  date column (Subscription `date_mm57yzmb`, Claims `date_mm57skrd`); an item shows only while
  its message is **newer** than that stamp (`lib/patientQuestions/handled.ts`), so a new patient
  message automatically reopens it — don't add a status column for this. Phone renders the
  Evaluate-style Call + Text buttons (`masheke/mmKit.tsx` `PatientContact`).
- **Fax Inbox** (`/fax-inbox`) reads inbound faxes from RingCentral.
- **Access admin** (`/access`, managers only) edits `access.json` (auto-saves per mutation).

---
