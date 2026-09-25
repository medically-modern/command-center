## 6. Patient flow across boards (the big picture)

```
DTC Intake (18392794310)
   │  "Send To Medical Necessity"
   ▼
Profile Send Off (18406352652)  ──profile role: complete demographics/insurance/doctor
   │  "Advance to MN" → automation 7917676280 creates the Medical Evaluation item
   ▼
Medical Evaluation (18406060017)──evaluate → sendRequest → confirmReceipt → chase (fax | email+parachute)
   ▼
Insurance (18410601299)         ──benefits → submitAuth → authOutstanding (→ authDenied)
   ▼
Welcome Call (18410804557)      ──welcomeCall → finalConfirm roles
   │  Final Confirm's advancer fires the create-item hop to Subscription (§5.14)
   ▼
Subscription (18407459988) / Claims boards  ──recurring orders, reconciliation
```

> ⚠️ **This diagram had Welcome Call SECOND until 2026-09-01** — straight after Profile Send Off,
> with Medical Evaluation third. It was wrong, and three things in the app say so and agree with
> each other: Profile Send Off's only exit is **Advance to MN**, whose automation creates the
> **Medical Evaluation** item (§3's own table says this); `config.ts` `ROLES` runs profile →
> evaluate/chase → benefits/auth → welcomeCall → subscription; and `OVERSIGHT_SECTIONS` runs
> intake → medical-evaluation → insurance → welcome-call. The order is now also a **module** —
> `lib/commsHub/pipelineOrder.ts` — because the Communications Hub draws a patient's stage history
> from it (§5.28), so a future disagreement shows up as a failing test rather than a wrong picture.

Movement between groups/boards is performed by **Monday automations** (e.g. "when Stage Advancer
status changes → set status / move item to group", and a "when item created → set statuses + copy
columns" automation on duplicated items). The SPA only flips the advancer; verify writes first.

---
