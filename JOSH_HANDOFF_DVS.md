# DVS Stage — Backend Handoff Notes (for Josh)

Working notes collected while designing `dvs-redesign.html` (UI-only prototype, July 2026;
**v2 2026-07-20 — the stage is now FULLY AUTOMATIC**). The prototype is the visual/behavioral
spec. This is a **new, dedicated view** — the third stage page after Submit Auth and Auth
Outstanding (see their handoffs), and it absorbs everything DVS-related that was stripped out of
those two pages. Your existing bot does the heavy lifting: it runs the DVS + claims and writes
results to the board. **v2 change: the page writes NOTHING — no Run button, no Complete button.
The Stage Advancer flipping to the new "DVS" stage (already added on Monday) IS the trigger;
everything downstream is bot-driven.** The view is a read-only monitor. The prototype simulates
results with timers. Companion doc: `HANDOFF-Josh-Manager-Views.md` (DVS retry queue + Auth
Denial land on the new Insurance manager view).

---

## 1. Who lands here (entry rules)

Everything the patient is served that bills straight NY Medicaid skips the auth rail and lands here:

- **Supplies-only Medicaid**: skips Benefits, Submit Auth, AND Auth Outstanding — DVS is their
  **first step** in the entire pipeline.
- **Pump + supplies on straight Medicaid primary**: also skips the whole rail; pump AND supplies
  both DVS here.
- **Managed Medicaid** (e.g. Fidelis + NY Medicaid secondary): pump rides the normal payer rail;
  once its auth is approved the patient arrives here for the **supplies only**.

The page shows this as two "path" cards (Straight to DVS / Pump Approved via Primary Payer) with
the actual one highlighted. DVS runs on the **Medicaid ID** (Member ID 1 for straight Medicaid,
Member ID 2 for managed duals). UI language is always **"Medicaid ID"** — never "CIN".

**How they arrive (v2):** skip patients get **Stage Advancer → "DVS"** written straight from
Profile Send-Off routing (never touching Benefits/Submit Auth/Auth Outstanding); auth-rail
patients get it when Auth Outstanding resolves. Either way, that stage write IS the DVS trigger
(§2) — there is no separate trigger column anymore.

## 2. The run steps — AUTOMATIC (v2, no rep action)

**Trigger = Stage Advancer → "DVS"** (the new stage value). The moment the stage flips — whether
from Profile Send-Off routing (skip patients) or from the auth rail finishing — the bot starts:

- **Pump DVS (E0784)** — submits FIRST, and only exists when the pump routes to Medicaid
  (straight Medicaid primary + serving a pump).
- **Supplies DVS (A4230 + A4232)** — when a pump step exists, supplies submit **automatically
  only after the pump claim is FULLY PAID** (not just auth-approved). No pump → supplies submit
  immediately on stage entry.

The old Run buttons are gone; each step shows a status chip instead (Submitting… / Running… /
Approved & paid / In retry queue / Auth Denial — manual review) plus "Waiting on pump" on the
gated supplies step. The page polls the board and streams your results in.

## 3. Per-code results: Authorization then Claim

Each run has two sub-steps per HCPC code, displayed as one column per code:

- **Step Na · Authorization** — DVS auth result per code, independently (E0784 alone; A4230 and
  A4232 each on their own).
- **Step Nb · Claim** — submits automatically once THAT code's authorization clears. Auth denied →
  claim shows "not submitted, authorization denied" and never fires.
- **Paid claims show the paid amount per code** — e.g. "✓ Paid · $268.50" — read off the board,
  so the bot needs to write a per-code paid amount.

Split outcomes are normal (A4230 clears while A4232 fails) and the UI renders each code's story
independently.

## 4. Failure handling — mirrors your two paths exactly

On any failure your code either:

1. **Flags for manual review** → the patient moves to the **Auth Denial bucket: Stage Advancer →
   Auth Denied + Escalation Required**. The page shows "Manual review — patient moved to the Auth
   Denial bucket" + the **error reason read from the board**, plus a **Re-run DVS** button for
   re-triggering after the underlying issue is fixed (eligibility, Medicaid ID, etc.). These
   patients also surface in the **Auth Denial chart** on the Insurance manager view.
2. **Enters the retry queue automatically** (re-submits a new DVS **once per day**) → the patient
   **stays in the queue until resolved — stage unchanged**. The page shows a pure **status**
   strip: "IN RETRY QUEUE — Last run 07/17, 3:00 PM · next run tomorrow." Nobody can trigger a
   queue retry from the UI. The queue is monitored from the Insurance manager view (Manager as
   Processor column).

**PRIORITY RULE (Brandon, explicit): manual review OUTRANKS the retry queue.** One code in manual
review + another in the retry queue → the patient goes to the Auth Denial bucket (Stage → Auth
Denied), not the queue.

**For the status strip the page needs to read: queue membership, which check failed (auth vs
claim), attempt count, last-run timestamp, and the latest error** — per code.

## 5. ⚠️ Partial re-runs only (Brandon, explicit)

**Any re-trigger — the daily retry queue OR a manual Re-run — must only re-run the codes that did
NOT get paid.** Example: A4230 auth + claim both cleared, A4232 failed → the retry queue re-runs
**A4232 only**. Approved-and-paid codes are never resubmitted. Same rule for the manual-review
Re-run button: it re-triggers just that code's failed check.

## 6. Cleared-from-queue trail

When a queued code finally passes, the rep needs to see that it **just cleared via the queue** —
the UI shows "✓ Paid · $114.30" with "RETRY QUEUE — just cleared: entered 07/16, paid on attempt 2
(07/17)". So the board data must let the page derive: it WAS queued, when it entered, which attempt
cleared it, and when. (Attempt count + entered date + cleared date, or equivalent.)

## 7. Stage / escalation writes — ALL bot-side (v2, no button)

- **Every code auth-approved AND claim-paid** → the bot writes Stage Advancer = **Complete**
  automatically → the existing automation moves the patient to the **Welcome Call board**. Fully
  paid patients require zero rep touches on this view — in the normal case nobody ever looks at
  them here.
- **Any manual-review flag** → Stage Advancer = **Auth Denied** + Escalation = **Escalation
  Required** (manual review outranks the retry queue, §4).
- **Retry-queue only** → no writes; stage stays at DVS while the queue grinds.

The old "DVS Complete" button is deleted — the actions card is now a status banner narrating what
the automation did (paid → Complete / holding in retry queue / moved to Auth Denial).

## 8. DVS Status by Product matrix (top of page)

DVS Required = light blue (the action on this view) → flips to mint "DVS Approved" as codes clear.
A pump approved on the payer rail shows green "Auth Valid · via <payer>". Not Serving faded.

## 9. Demo scaffolding — strip before production

- Demo scenario switcher + "Advance a day" link (stands in for the queue's real daily run).
- Simulated result timers + the page-load auto-trigger — in production the trigger is the Stage
  Advancer change itself; the page only polls and renders.
- Monday Board Output drawer — keep while implementing to verify writes, then delete (the status
  banner card below it stays).
- `PAID_AMOUNTS`, error codes/messages, and 30-ish-second result timings are demo placeholders.

## 10. What the page needs from the board (column IDs TBD — main open item)

Per code (E0784 / A4230 / A4232): DVS auth result + error, claim result + error, **paid amount**,
retry-queue state (in/out, which check, attempt #, last run at, entered date), manual-review flag.
Plus the run-trigger column(s) this page writes. Send over the column IDs and we'll wire the
prototype's read model to them.

## Open questions

- Error classifier: which eMedNY codes map to manual-review vs retry-queue (the UI just renders
  whatever you decide, but Brandon should see the list).
- Claim auto-submit after auth passes — confirm that's how the bot sequences it per code.
- Pump DVS denied on a straight-Medicaid patient — handling still TBD (for now: manual review path).
- CGM + Medicaid hybrid (supplies DVS waiting on CGM auth or not) — still undecided.
- Retry queue give-up condition (max attempts before it flips to manual review?).
