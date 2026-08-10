# Handoff — Patient Intake (DTC & CareCentrix) build state, 2026-08-10

The stage at `/unverified-referrals` (role id `unverifiedReferrals`, label
**Patient Intake — DTC & CareCentrix**). Everything below is on `main`.

> **Verify that claim before trusting it.** The previous version of this file
> said "everything below is on `main`" while the whole build sat unpushed on a
> `claude/…` branch — so Pages was serving none of it. `git ls-remote origin
> refs/heads/main` and compare to your HEAD; don't infer it from a clean tree.

## ⚠️ Read these two FIRST — they are in the repo

| File | What it is |
|---|---|
| [`patient-intake-redesign.html`](patient-intake-redesign.html) | **THE SPEC.** Corey's mockup. Open it in a browser AND read its DOM. Stylesheet is `redesign.css` (PART A) + `src/pages/profile/intake.css` (PART B). |
| [`HANDOFF_PATIENT_INTAKE.md`](HANDOFF_PATIENT_INTAKE.md) | Josh's written spec — the §-numbers this file cites. |

**Port from the mockup's MARKUP, not its section headings.** Building from
headings is how an earlier pass invented cards ("On the call", "Why they came")
that the mockup doesn't have.

> **The mockup's `NEW COLUMN NEEDED` stamps are mostly stale** — but NOT all of
> them, and the previous version of this file said otherwise. See
> "Where the column inventory was wrong" below before you plan any work on the
> strength of "it's pure front-end".

> **The `FROM FORM → color_xxx` stamps are BUILD NOTES, not UI.** HANDOFF's
> preamble: "They are NOT part of the design and must NOT appear in production."

---

## The left pane is ported

Every section of the mockup's left pane is now rendered, in mockup order, and
round-trips to Monday:

Referral Email rail-card (Monday **updates**, not a column — `fetchUpdates`,
plus ＋ Add referral email via `createUpdate`) · Files rail-card
(`fetchItemAssets` → `FileViewerModal`) · Referral Routing · Patient
Demographics (First/Last split, Gender, Address) · What They Need (category
checkboxes that hide a whole column, CGM Type / Pump Type / paths / awareness,
CGM Data File) · Care Assessment · Cost & Coverage · Provided Insurance
(segmented Provided Via, Insurance Card Photo, Start Insurance Follow-Up) ·
Provided Doctor Info · Proceed Preference (pills, booking, Confirm booking) ·
Email patient? · Call Log & Notes · Ready to Advance (three `.route` cards).

The right pane was already the mockup's four numbered steps.

Deliberately NOT on the left pane, though the mockup has them:
- **Clinic Address** — commented out (Josh, 2026-08-10). Step 3's provider sets
  the verified address, which is the value that carries forward. It is also out
  of `intakeEditsFor`; restoring one without the other lets a Save clear it.
- **Doctor Notes** — the right pane's Select Correct Provider already carries
  the panel, and it is the same Doctor Database record either way.
- **Text**, in Patient Messages — the Call/Text buttons sit by the patient's
  name and that dialog holds the real RingCentral thread. Two composers for one
  conversation, only one showing history, is worse than one. So that card is
  email only, and collapsed until asked for.

**The PART B CSS was already complete** — every class the mockup uses was in
`intake.css` before any of this markup existed. So if a section looks unstyled
the class name is usually wrong, not missing — but check the traps table below
first: `.upzone` is `display:none` without `.show`, and `.pf-root` strips bare
buttons. Both look like "unstyled" and neither is.

### Still not built, all deliberate

| | Why |
|---|---|
| **Benefits Check Output** | §3/§10 — pending Corey's plan-level research. **Do not build.** Leave the Stedi plumbing alone. |
| **Calendly booking picker** (§7/§7.2) | No integration. The override is free text + an explicit Confirm — a dropdown of invented times is worse than none, because the rep would believe those openings exist. 🟡 OPEN: can the rep *book*, or only view? |
| **Send photo upload link to patient** (§8.3) | Needs the tokenized-URL service. The **rep-side** upload is built, so the file half works — see Files below. |

### Files

Monday files live **in a column**, not loose on the item, and this board has
exactly two — so an upload has to pick one and the UI names which:

| Control | Column | Source |
|---|---|---|
| *Upload insurance card* (Files card) | `file_mm5zhy1` | The patient can attach this on the intake **form**, so it often arrives on its own; the button is the fallback for cards that come by text or email. |
| *Upload CGM data* (Files card) + the drop zone under What They Need | `file_mm5zhsxh` | **Never** from the form. §8.3 has the rep send a tokenized upload link ON THE CALL; that link is unbuilt, so the button is the only route today. |

A genuinely untyped "patient documents" bucket would need a **new Files column
on the board** — a board change, not a UI one.

---

## Where the column inventory was wrong

The previous version of this file said: *"every field in the mockup already has
its Monday column — the remaining work is pure front-end."* That was wrong
twice, and both cost a round trip to find:

1. **CGM Type (`color_mm1w7pmf`) and Pump Type (`color_mm1wjjtk`)** had a `COL`
   entry, a `READ_COLUMN_IDS` slot, a mapping line, a `Patient` field and an
   index map — everything except a control and a write path. They were
   invisible AND unsaveable, and the page showed `formCgmPreference` /
   `formPumpPreference` (what the patient *said they wanted*) in their place.
   Two of the four dropdowns §5.2 names. Fixed.
2. **Clinic Address** and **Helpful Links / Identification Info** genuinely had
   no column. Resolved by Josh (2026-08-10) without creating any:
   - Clinic Address was pointed at the **verified** column `location_mm1xjnfv`
     — the one authorised exception to §6.0's "provided ≠ verified" — and then
     the field was dropped from the pane entirely as unnecessary. The write
     path and the de-dup rule below still stand if it ever returns.
   - "Helpful Links / Identification Info" **is Doctor Notes** — the shared
     `DoctorNotesPanel` the Medical Necessity tabs carry. It lives on the MM
     Doctor Database keyed by NPI, so it is per-DOCTOR and needs no column on
     the patient. It activates once step 3 supplies an NPI.

**Lesson for the next inventory:** "the column exists" and "the field works" are
different claims. Check `COL` → `READ_COLUMN_IDS` → `mondayMapping` → `Patient`
→ `IntakeEdits` → `buildIntakeTasks` → a control. A gap anywhere in that chain
is silent.

---

## Write-path defects fixed (2026-08-09/10)

All four shipped green, because the only thing that would have caught them is a
live board. Guarded now by `src/lib/profile/unverifiedWrite.test.ts`.

1. **Approve Stuck was a no-op that reported success.** It wrote Escalation
   index 2 — the index the patient already carried, since index 2 is what puts
   them in Final Decisions — then toasted "marked Stuck" and navigated away.
   The stage had no working terminal exit. Now: stamped note → **group move to
   `GROUPS.stuck`** → clear escalation. It is a group move, not a status flip,
   because `Move to Onboarding` has no Stuck option on this board. A failed move
   bails **without** clearing the escalation.
2. **The page's own Propose Stuck ignored the ladder and the toast lied** —
   always wrote Manager Intervention while claiming Final Decisions. Now
   computes `proposeStuckLevel` once and uses it for the write and the message.
3. **An advance verified only the doctor columns.** The left pane (~30 cols) and
   verified insurance (5) went out as loose `allSettled` passes before the
   advancer flipped, so of the 52 columns automation **7917676280** copies, only
   the doctor block was guaranteed indexed. Worse, with no doctor picked
   `buildDoctorTasks` returned `[]` and `verifiedWrite` skips snapshot+read-back
   entirely (`verifyColIds.length > 0`), firing the advancer unverified. All
   three families are one task list now; an empty list is refused.
4. **A partial save still advanced the patient** — `save()` reports failures
   instead of throwing, so "Saved, except: X" was overwritten by "Advanced".
   Folding the writes into the single verified transaction fixed it.

### Two traps worth knowing

- **`buildAdvanceTasks` de-duplicates by column, last wins.** Clinic Address is
  emitted by *two* builders (left pane + `buildDoctorTasks`). Both firing in one
  transaction is a race deciding the patient's address, verified against
  whichever landed. Doctor block is appended last, so the **picked provider
  wins over what the patient said** — that ordering is the contract.
- **Notes are append-only.** `notes` was in `IntakeEdits`, written with a plain
  `text()` overwrite. Inert only because nothing rendered a notes box — binding
  Call Log & Notes to it would have replaced the whole history on first save.
  It is removed from `IntakeEdits` (a test pins that) and appends through
  `appendIntakeNote` → `appendStampedNote` (§9: ET + stage + initials).

---

## Messaging — read this before touching it

**Text** is Evaluate's Call/Text buttons (`mmKit.PatientContact`), beside the
patient's name. That dialog holds the real RingCentral thread. Sends go through
the **gateway** (`messagingApi.sendMessage`), never straight to RingCentral, so
the sender comes off the verified Google token server-side. "Start Insurance
Follow-Up" opens the same dialog with a template; the plain Text button opens it
empty.

**Email** is its own collapsed card, reusing `sendViaWorker` — the route Send
Request uses. No merged history: the SMS thread is real, sent email has no
per-patient store to read back, and a combined list would imply a record we
don't keep. Sent emails are appended to the Call Log instead.

⚠️ **Sending is blocked on `consentState` (TCPA/CTIA) and must stay that way.**
Our sends use the plain `/sms` endpoint, not High Volume SMS, so nothing
upstream stops a rep texting someone who replied STOP. A thread that fails to
load sets `complete = false`, which also blocks: "no STOP found" in a truncated
history is the absence of evidence, not consent.

> **`mmKit`'s composer had NO guard until 2026-08-10.** Only the Assigned
> Patients inbox enforced it, so the same rep could text an opted-out patient
> from Evaluate, Patient Questions, Doctor Appointments or Patient Intake
> instead. It now runs the same `consentState` and disables the box with the
> reason. If you add another composer, it needs the guard too — the check
> belongs at every send point, not at one of them.

---

---

## The queue — settled 2026-08-10

**Patient Intake is the DTC form's two groups and nothing else**: New Form —
Completed (`group_mm5zgeak`) and New Form — Partial (`group_mm5z87zt`). It does
not look at `1. Intake`. CareCentrix arrives in Completed via automation
`7921666432`, so it needs no filter of its own.

**`1. Intake` is now entirely Verified Referrals** (minus Already In System).
`profile-send-off` had to WIDEN in the same change — it used to exclude
Referral Type `Patient` / Source `CareCentrix`, and with intake no longer
claiming those ~90 patients they'd have matched no chart and gone invisible
app-wide (§7).

That killed the referral split as a *queue* rule: `profileReferralRole` returns
`inSystem` or `verified`, never `unverified`. `isUnverifiedReferral` is kept and
still tested — it's the right question to ask about a referral for labelling, it
just no longer decides anything.

All five §5.10 places were changed together: `referralSplit.ts`,
`useRoleCounts.ts`, `snapshot-baseline.mjs`, `baseline-cron/index.mjs`,
`oversightApi.ts`. **The role page is a sixth** — `ProfilePage` filters its LIST
through `profileReferralRole`, which is how the same bug nearly shipped
mirrored: patients counted in `profile` and drawn in its chart, but filtered off
the page.

The Oversight bar graph has an **All / Completed / Partial** toggle, filtering on
the `groupId` each row already carries.

---

## Traps this stage has already fallen into

All of these fail SILENTLY — a blank, a zero, or unstyled markup. None throw.

| Trap | Symptom |
|---|---|
| **`BOARD_GROUPS` must list a group before any chart can filter on it** | Chart renders **0**. The form groups were absent, so intake charts only ever matched inside `1. Intake`. |
| **A filtered column must be in the fetched column set** | `colIndex` is undefined ⇒ index conditions never match. `color_mm5zww42` wasn't fetched, so Manager Intervention and Final Decisions were empty from the day they were added. |
| **`.pf-root` resets bare elements** — `.pf-root button` clears background/border/colour, beating Tailwind on specificity | Every shadcn control inside renders stripped. Scope `.pf-root` to the panes, never the sidebar or header (ProfilePage does the same). |
| **`.pf-root .panes-host` is a DESCENDANT selector** | Both classes on one div ⇒ `container-name` never set ⇒ `@container` never fires ⇒ the two-pane split silently stacks. |
| **`.upzone` is `display:none` until `.show`** | The mockup revealed it from JS. Used without `.show`, an upload control is invisible. |
| **Column ID prefix must match the write primitive** | `writeLongText` on `text_mm389fs` ⇒ Monday rejects with "invalid value…". Audited all 32 helper sites + direct calls; `notes` was the only mismatch. |
| **A FILE column's `text` is a URL, not a filename** | Join on `value`'s `assetId` instead. The asset's `public_url` is signed; the column's `protected_static` link needs a Monday session and can't open on its own. |
| **`writeDate`/`writeLocation` with a blank string CLEAR the column** | Any field in the bulk save with no control behind it can wipe what another path wrote. `notes`, `followUp`/`followUpDate` and `clinicAddress` are all deliberately OUT of `intakeEditsFor` for this reason. |

### CSS notes

`.pf-root .why` was defined **twice** — the always-visible reasoning note and
§4's ⓘ hover circle — and the later one won, rendering the note into a 16px
italic circle whose text overflowed across the Save button and the next card's
header. The hover one is `.whyicon` now; both sets are kept because the §4
ruling is still open.

No other selector is duplicated *inside* `intake.css`. Five are defined in both
`intake.css` and `redesign.css` — `.file-row`, `.route`, `.route-grid`,
`.step-head`, `.step-num` — which is fine: `intake.css` imports second and
either augments or repeats. Worth knowing: `.route` gets `opacity:.6` from
`redesign.css` with `.route.on` restoring it, so a route card without `on` is
dimmed. That's the mockup's own behaviour for the inactive Advance card.

## Notes is the record

Josh, 2026-08-10: the Call Log (`text_mm389fs`) is where all free text lives for
future reference. Every stage decision routes through `logDecision`, which
writes BOTH the escalation column (the manager's audit trail) and the Call Log —
one implementation, so a path added later can't write one and forget the other.

Propose Stuck stamps its rung: nothing for a processor, `— Manager Escalation`,
`— Final Escalation` (`proposeStuckNoteLine`, tested). Cost and Self Advocacy
mirror in on save, once, only on change. Sent **emails** log too (a text keeps
its RingCentral thread; email has no per-patient store).

## Open — needs Josh, don't guess

1. 🔴 **§4: the confidence pill.** §4 says remove the confidence label and put
   the engine's reasoning behind an ⓘ hover. Josh asked in-session for it
   readable *without* clicking in. What ships is always-visible **and** keeps a
   `HIGH CONFIDENCE` pill — which is the specific thing §4 says to drop.
   Whichever way this goes it is a markup swap; both style sets exist.
2. ~~Queue definition.~~ **DONE 2026-08-10** — see "The queue" below.
3. ~~Verify automation `7921666432`.~~ **DONE 2026-08-10** — read off the live
   board: active, trigger *new item created*, condition *Referral Source is
   CareCentrix*, action *move to New Form — Completed*. Correct. Note it has
   never actually fired: there are **zero** CareCentrix-sourced items on the
   board, so the first real CCX referral is still its first test.
4. §5.2 wants the four product dropdowns sourced from `settings_str` at runtime
   with the hardcoded maps as fallback. **The data-loss half is fixed** — a
   board value the picker doesn't offer renders as a disabled "not selectable"
   option (`selectOptions.ts`) instead of a blank select — but the lists are
   still hardcoded.
5. §7.1 questions still unanswered: is **CGM Data & Doctor Awareness**
   conditional on CGM Coverage Path = `Hypoglycemia`, or always shown with the
   CGM category? Is **Cost & Coverage** gated on Reason = pharmacy cost?
6. **`intakeCallComplete` can't be un-ticked** (write-only-when-truthy). Same
   one-way trap the new `Pills`/`Seg` controls deliberately avoid by clearing on
   a second click of the active option.
7. 23 pre-existing typecheck errors on `main`, none in this slice. `npm run
   typecheck` (`tsc -b`) is the real check — bare `tsc --noEmit` reports 0
   because the root tsconfig is `"files": []` with references.

---

## Test data on the live board

Two fake patients in **New Form — Completed** (`group_mm5zgeak`), safe to delete:

| Name | Item | Use |
|---|---|---|
| `ZZ TEST - Locked Pane (delete me)` | `12749042292` | *Wants a call first* → right pane locked, one tick from unlocking |
| `ZZ TEST - Unlocked Pane (delete me)` | `12749065376` | *Send request now* + full fake Stedi → right pane open |

Both count in the role bar and burndown while they exist.

### Never exercised against a live board

Unit-tested only — all of these need a browser session with a Monday token:

- **The doctor write and the verified advance.** Pick a provider in step 3, hit
  Advance to MN, confirm Doctor Name / NPI / Fax are populated **before** the
  item moves to Completed.
- **`approveIntakeStuck`'s group move** (note → move → clear, and that a failed
  move leaves the escalation alone). Its ordering has no test — this repo has no
  `vi.mock` precedent in 1000+ tests, so the write-path tests cover only pure
  functions and paths that short-circuit before the first network call.
- **Both baseline generators** (`scripts/snapshot-baseline.mjs`,
  `services/baseline-cron/index.mjs`) — they need a gateway token and were
  verified by line-by-line match against `useRoleCounts` only.
- **Patient Messages.** Texting needs `VITE_MONDAY_GATEWAY_URL`; email needs a
  signed-in medicallymodern.com session. ⚠️ Unlike everything else here, these
  send **externally to a real person** — the ZZ TEST patients have fake contact
  details, so a send fails at the transport rather than reaching anyone.

---

## Conventions this stage follows

- Status columns are written **by index, never by label** (§5.2) — Monday drops
  an unknown label without erroring. All index maps verified against the board.
- **Provided ≠ verified** (§6.0) — `writeIntakeEdits` doesn't touch the verified
  doctor columns. Clinic Address is the one authorised exception (above).
- Every write is a separate task with `Promise.allSettled`, so one rejected
  column can't discard the rest — the UI reports "Saved, except: X".
- A blank field means *"not set"*, never *"clear the board"*. Guard every task.
- **Monday dates are timezone-naive ET.** Use `etToday()`, never a bare
  `new Date()` — in a UTC runtime anything after 8pm ET dates to tomorrow.
