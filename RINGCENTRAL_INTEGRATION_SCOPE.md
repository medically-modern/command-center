# RingCentral integration — scope & build plan (2026-08-04)

> **STATUS: built.** A, B (outbound) and D shipped on
> `claude/ringcentral-integration-scope-867uiv`. C is cut. What remains before it
> works in production is **config, not code** — see §9.

Get the reps out of the RingCentral app: a texting inbox scoped to the patients each rep owns, a
manager view to assign patients, and click-to-call.

| | Ask | Status |
|---|---|---|
| **A** | "Assigned Patients" role — texting inbox filtered to a rep's assigned numbers | in scope |
| **B** | **Place** calls from the UI | in scope — outbound only |
| **C** | ~~Inbound-call notification + per-rep allowlist~~ | **cut (Josh, 2026-08-04)** |
| **D** | Manager view: employees → assigned patients, assign + text | in scope |

**Answering calls is out of scope**, and that removes nearly every hard constraint this integration
had. What's left needs **no new RingCentral app, no per-rep login, no VoIP licensing, and no
approval scopes** — see §2.

---

## 0. Decisions already made

- **Assignment means patient numbers, not DIDs.** Reps text and call from the **single MM number**;
  what's assigned to them is a set of patient phone numbers. No RC provisioning API involved.
- **Assignments live in a dedicated Railway Postgres** (Josh), served by the existing gateway (§4).
- **Don't use RC's SMS Thread Messaging API** (§3).
- CLAUDE.md §10 is stale: the RC secret no longer ships in the browser bundle, it's in the gateway.

---

## 1. What already exists (reuse, don't rebuild)

- `services/monday-gateway/ringcentral.mjs` — server-side RC proxy at `${GATEWAY}/rc/<path>`, JWT
  auth, refresh on 401. `ALLOWED_PATH` permits **`message-store` + `sms`**, methods `GET/POST/PUT`.
- `src/lib/fax/ringcentralApi.ts` — `sendSms` (incl. the 5xx-but-delivered workaround),
  `fetchSmsConversation`, fax inbox, `setFaxRead` (the read/unread pattern).
- `src/lib/accessStore.ts` + `public/data/access.json` — processor registry, edited at `/access`.
- `src/lib/config.ts` `ROLES[]` — **"Assigned Patients" is a new entry here**, exactly like the
  `updateClinicals` role.
- `services/monday-gateway/db/` — the gateway already owns a Postgres and applies schema on boot.

---

## 2. Ask B — outbound calling, without WebRTC

Dropping inbound means **RingOut** replaces the whole softphone stack:

```
POST /restapi/v1.0/account/~/extension/~/ring-out
{ "from":     { "phoneNumber": "<the rep's own phone>" },
  "to":       { "phoneNumber": "<the patient>" },
  "callerId": { "phoneNumber": "<the MM number>" },
  "playPrompt": false }
```

RingCentral calls the rep's phone first, they pick up, RC connects the patient — and the patient sees
the **MM number** as caller ID. Status via `GET .../ring-out/{id}`, cancel via `DELETE .../ring-out/{id}`.

**RingOut requires no WebRTC and no Digital Line.** Compare:

| | RingOut | WebRTC softphone |
|---|---|---|
| New RC app / PKCE login | ✅ none — existing JWT | ❌ per-rep login |
| Digital Line per rep | ✅ not needed | ❌ licensed seat each |
| `VoipCalling` scope | ✅ not needed (`RingOut` scope) | ❌ required |
| 5-instance ceiling | ✅ doesn't apply | ⚠️ applies |
| Audio path | the rep's own phone (cell/desk) | browser + headset |
| Build cost | one gateway allowlist line + a button | widget, auth, licensing |

> **Recommendation: RingOut for v1.** It delivers "click a patient, get connected" — which is the
> actual ask — for a fraction of the work, and it takes reps out of the RingCentral *app*, which is
> the goal. It is not a dead end: adding a WebRTC softphone later changes nothing else in this build.

The honest trade: audio is on the rep's phone, not a browser headset. If headset-in-browser is a firm
requirement, say so now, because that's the one thing that pulls the whole per-rep auth + licensing
stack back in.

> Note for a possible WebRTC v2: the instanceId collision described in earlier revisions only breaks
> **inbound** — "older instances can still make outbound calls." So an outbound-only softphone may
> dodge the 5-instance ceiling on a shared login too. That needs a live test; RingOut needs none.

**Gateway changes:** add `ring-out` to `ALLOWED_PATH`. ⚠️ Cancel needs `DELETE`, which the gateway
currently blocks (`["GET","POST","PUT"]`) — either scope an exception to this path or skip cancel in v1.

**Where the rep's `from` number comes from:** a `phoneNumber` field on the processor record in
`access.json`. Small, rarely changes — exactly what that file is good at.

---

## 3. Ask A — "Assigned Patients"

A new processor role whose page is a **filtered SMS inbox**: sidebar of conversations, click for the
thread, reply from the MM number. Mirrors the RingCentral Text screen.

- **Conversation list** — `GET .../message-store?messageType=SMS`; SMS records carry a
  `conversationId` derived from the from/to pair, so threading is client-side. For polling, prefer
  **Message Sync** (`.../message-sync`): full sync once, then **incremental syncs with a sync token**,
  returning only changes. ⚠️ Different path ⇒ one `ALLOWED_PATH` addition.
- **Thread view** — `fetchSmsConversation()` already does this.
- **Send** — `sendSms()` already does this, with the 5xx quirk handled.
- **Filter** — only conversations whose counterparty is in this rep's assigned set (§4).
- **Call** — the RingOut button (§2) on the open conversation.

> ⚠️ **The 24-hour `dateFrom` trap.** RingCentral's message store defaults `dateFrom` to ~the last
> 24 hours. Every existing call in `ringcentralApi.ts` passes an explicit lookback for this reason —
> the inbox must too, or anything older than a day silently vanishes.

> ⚠️ **Read state is account-wide.** `readStatus` is real (the fax inbox already uses it via
> `setFaxRead`), but if Janelle reads a thread it's read for everyone. Per-rep unread has to be ours.

### Don't use RC's SMS Thread Messaging API

It looks like exactly this ask — shared inbox, thread `assignee`, `status`, `POST .../message-threads/{id}/assign`.
It's the wrong tool:

> ⚠️ **RC threads auto-resolve after 72 hours and can never reopen** — a later message from the same
> patient starts a **new thread with no assignee**. RC's assignment is *conversation-scoped and
> ephemeral*; ours must be *patient-scoped and durable* (Janelle owns that patient for the weeks they
> spend crossing Evaluate → Benefits → Welcome Call). She'd fall off every patient who goes 3 days
> without texting.

Also: paid **Business SMS Booster license per extension**, assignee is an *RC* user rather than a
Google identity, and **no per-handler read state** so it doesn't fix the above either.

### ⚠️ Opt-out / TCPA — handle it while we're in here

RC auto-handles STOP/START **only for High Volume SMS**; our sends use the plain `/sms` endpoint, so
**nothing currently honors an opt-out**. A patient who texts STOP and keeps receiving texts is real
exposure for a healthcare provider. Cheap fix: scan inbound for STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT,
flag the number, block sends in the UI.

---

## 4. The assignment store

**Decided: a dedicated Railway Postgres**, separate from the audit DB — but served by the **existing
gateway**, not a new service. The gateway already verifies Google identity, is CORS-locked to the app
origin, and proxies RC; a second connection string plus a few endpoints is far less surface than a new
service with its own auth, CORS and deploy target.

> 🔴 **This would be the first PHI at rest outside Monday.** The audit DB is deliberately
> `LOG_PAYLOAD=false` so the gateway stores no patient data (CLAUDE.md §8). A phone number tied to a
> patient **is PHI** — one of HIPAA's 18 identifiers — so a naive `phone → rep` table gives that up.

**Keep the property: store a keyed hash, not the number.**

```sql
CREATE TABLE IF NOT EXISTS phone_assignments (
  phone_hmac      TEXT PRIMARY KEY,  -- HMAC-SHA256(pepper, E.164) — NOT the number
  rep_email       TEXT NOT NULL,     -- janelle@medicallymodern.com
  monday_item_id  TEXT NOT NULL,     -- the patient; everything readable comes from here
  monday_board_id TEXT,
  assigned_by     TEXT,              -- verified actor from X-MM-Auth
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phone_assignments_rep_idx ON phone_assignments (rep_email);
```

- **Inbound message** → normalize to E.164 → HMAC → single-row lookup.
- **Rendering a rep's list** → query by `rep_email` → item ids → fetch from Monday. Names and numbers
  come from Monday at render time, which the UI must do anyway.

> ⚠️ **The pepper is load-bearing.** A bare SHA-256 of a 10-digit number is brute-forceable in seconds
> (~10¹⁰ candidates). It must be an **HMAC with a server-side secret**, or the hashing is theater.
> Normalize to E.164 *before* hashing or the same patient hashes differently by input format.

Cost: you can't eyeball the table to see who owns whom. Benefit: no PHI, so no BAA conversation about
this database. (Raw numbers are a fine alternative — but then confirm Railway's BAA posture first.)

**Why not a JSON file in git:** every `access.json` write is a commit, and commits trigger a Pages
deploy — fine for roles, wrong for constantly-changing assignment. And `sync-from-test.yml` only
preserves `access.json`, so a new data file gets clobbered on prod by test's copy.

**Naming implication:** the assign control in D should be **patient-first, not number-first** — the
manager picks a patient, which yields both the number and the Monday item id.

---

## 5. Ask D — manager view

**Ask A with an employee picker in front of it.** Build A's components parameterised by rep from the
start and D is mostly assembly:

- employee list — from `access.json` `processors`, already loaded app-wide;
- click an employee → their assigned patients + conversation history — **the A page, for that rep**;
- manager can text and call the patient — same `sendSms` / RingOut;
- plus assign/unassign, the only genuinely new UI.

**Placement** — *"under welcome call in MANAGEMENT"* needs a decision: a tab in `/system-mgmt`
alongside Oversight/Operations, or a section on the Welcome Call page in manager mode. `/system-mgmt`
is where every other manager view lives and this isn't Welcome-Call-specific, but it's Josh's call.

---

## 6. Build plan — what we'd add

Nothing here touches Monday boards, automations, verified-write, or the role/oversight machinery.

### Phase 0 — infrastructure

| Where | Change |
|---|---|
| Railway | new Postgres service for assignments |
| `cmd ctr server` env | `ASSIGNMENTS_DATABASE_URL`, `PHONE_HMAC_PEPPER` |
| `services/monday-gateway/assignments.mjs` | **new** — table bootstrap, HMAC, `GET/POST/DELETE /assignments` |
| `services/monday-gateway/index.mjs` | register the assignments routes |
| `services/monday-gateway/ringcentral.mjs` | `ALLOWED_PATH` += `message-sync`, `ring-out` |
| `services/monday-gateway/.env.example` | document the two new vars |

### Phase 1 — ask A + click-to-call

| Where | Change |
|---|---|
| `src/lib/config.ts` | `ROLES[]` entry `assignedPatients` |
| `src/App.tsx` | route — ⚠️ **`lazyWithReload`, not bare `lazy`** (CLAUDE.md §9) |
| `src/pages/AssignedPatientsPage.tsx` | **new** page |
| `src/lib/assignedPatients/assignmentsApi.ts` | **new** — gateway CRUD |
| `src/lib/assignedPatients/conversations.ts` | **new** — thread grouping + sync-token handling |
| `src/lib/assignedPatients/optOut.ts` | **new** — STOP detection |
| `src/lib/fax/ringcentralApi.ts` | add `fetchSmsThreads()`, `startRingOut()` (`sendSms` unchanged) |
| `src/components/assignedPatients/` | `ConversationSidebar`, `ConversationThread`, `MessageComposer`, `CallButton` |
| `src/hooks/assignedPatients/` | `useSmsThreads` (poll + incremental sync), `useAssignments` |
| `src/lib/accessStore.ts` | `phoneNumber` on the processor record (RingOut `from`) |

### Phase 2 — ask D

| Where | Change |
|---|---|
| `src/pages/` or `src/components/oversight/` | manager view (placement TBD, §5) |
| `src/components/assignedPatients/AssignPatientDialog.tsx` | **new** — patient-first assign |
| `src/components/assignedPatients/EmployeeRail.tsx` | **new** — employee list |

### Tests (vitest, per repo convention)

`optOut.test.ts` · `conversations.test.ts` (grouping, dedupe, E.164 normalization) · HMAC round-trip.

### Explicitly NOT needed

No new RC app · no PKCE / per-rep login · no `VoipCalling` · no `CallControl` (approval scope) · no
Digital Lines · no Monday board or automation changes · no `verifiedWrite` involvement · no change to
`sendSms` · no new build secrets in the SPA bundle.

---

## 7. Decisions taken during the build

- **Headset-in-browser: not required** → RingOut, no WebRTC. (§2)
- **Per-rep unread: yes, build it** → `thread_reads` in the assignments DB. RingCentral's own
  `readStatus` is account-wide and is deliberately not used for the inbox.
- **Opt-out guard: yes, in Phase 1** → `lib/assignedPatients/optOut.ts`, blocking the composer.
- **RingOut cancel: skipped** → would need `DELETE`, which the gateway's method allowlist *and* its
  CORS layer both exclude. Starting the call is the feature.
- **`from` number:** patients always see the MM number (`callerId`). `from` is a per-rep
  "call-me-at" number on the processor record, because `from` is who **RingCentral rings**, not what
  the patient sees — pointing it at the main line rings the main line. Blank falls back to the MM
  number with a visible warning on the page.

## 8. What shipped

| Area | Files |
|---|---|
| Gateway | `assignments.mjs` (new) · `index.mjs` · `ringcentral.mjs` (allowlist += `ring-out`) · `.env.example` |
| RingCentral client | `lib/fax/ringcentralApi.ts` — `fetchSmsThreads`, `startRingOut`, `mmPhoneNumber`, `toE164` exported |
| Domain | `lib/assignedPatients/` — `assignmentsApi`, `patientLookup`, `optOut`, `format` |
| Hook | `hooks/assignedPatients/useAssignedThreads.ts` |
| UI | `pages/AssignedPatientsPage.tsx` · `components/assignedPatients/` — sidebar, thread, assign dialog |
| Wiring | `lib/config.ts` (role) · `App.tsx` (route, `lazyWithReload`) · `accessStore` + Access page (`phoneNumber`) |
| Tests | `optOut.test.ts` (17) · `unread.test.ts` (5) |

One page serves both roles: `/assigned-patients` is the rep's own queue, `?rep=<email>` is a
manager viewing someone else's. Managers additionally get the employee rail, the **Unassigned**
folder, and the assign dialog; a processor sees their queue and nothing else, whatever the URL says.

## 9. Before it works in production — config, not code

| Step | Status |
|---|---|
| Railway Postgres provisioned (with volume) + `ASSIGNMENTS_DATABASE_URL` on `cmd ctr server` | ✅ done 2026-08-04 |
| `PHONE_HMAC_PEPPER` set | ✅ done |
| `MANAGER_EMAILS` set to mirror `access.json` managers | ✅ done |
| Add the **`RingOut` scope** to the RingCentral app (not an approval scope) | ⬜ Josh |
| Assign the role in `/access` + set each person's *call-me-at* number | ⬜ Josh |

⚠️ The Postgres service is named **`Postgres`** in Railway, not `cmd ctr phone db` — the provisioning
API couldn't rename it, so `ASSIGNMENTS_DATABASE_URL` references `${{Postgres.DATABASE_URL}}`.
Renaming it in the dashboard means updating that reference too.

`GET ${GATEWAY}/assignments/health` reports whether the DB and pepper are live.
⚠️ Changing the pepper later orphans every assignment — all hashes change.

## 10. Still open

1. **Placement of D.** The manager view currently lives on the role page itself (employee rail on
   `/assigned-patients`), which is discoverable and needed no new tab. If it should instead sit under
   Welcome Call in `/system-mgmt`, that's a link, not a rebuild.
2. **Search is by patient NAME.** Assigning from an unassigned conversation means finding the patient
   by name; there's no number → patient reverse lookup yet (§6 of the earlier revision). Worth adding
   if reps often get texts from unknown numbers.
3. **The inbox re-reads its whole window each poll** (90 days, 250 messages). RingCentral's
   `message-sync` is the lighter path if this gets slow; it is deliberately not allowlisted yet.
