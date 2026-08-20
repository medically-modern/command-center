# Incident — 2026-08-20 — one dependency array took out the phone system

**Impact:** ~80 minutes (1:50–3:11 PM ET) of RingCentral REST reads failing across
**both test and prod**: no SMS history (so **texting was blocked for every patient**),
no unread-fax count, no call log, and no way to verify the inbound-call subscription.
Six false "no calls will arrive" pages to the team.

**Not affected:** inbound calls themselves. Webhooks were delivered and fanned out to
browsers the entire time — `events.seen` kept climbing and calls kept ringing. Every
alert claiming otherwise was wrong.

**Cause:** a React dependency array in one component, shipped by me in `ed8e33e`.

---

## 1. What happened

`ed8e33e` ("Fire C13 only on a dropped product; surface undeliverable texts") added
`useDeliveryRecheck` to the intake Messages card. The hook returned a **fresh object
literal on every render**:

```ts
return { schedule, cancel };     // new identity, every render
```

`IntakeMessages` listed that object in a `useEffect` dependency array:

```ts
useEffect(() => {
  recheck.cancel();
  setMessages([]);            // a NEW array — React can never bail out on equality
  void loadThread(true);      // fire-and-forget POST /messaging/conversation
}, [patientId, loadThread, recheck]);
```

effect runs → `setMessages([])` → re-render → **new `recheck` object** → deps changed →
effect runs again. Unbounded.

**Measured at the gateway: 501 requests in 0.43 seconds from a single browser — ~1,166
requests/second**, all returning 502. That is the Railway log page limit being hit in
under half a second, so the true rate was higher.

`/messaging/conversation` pages the RingCentral message store up to `MAX_PAGES = 10`
deep, so the fan-out to RingCentral was up to ten times worse again.

RingCentral throttled the **whole account**. Everything else that touches RingCentral
went down with it — none of which had anything to do with texting.

## 2. Why it was that fast

Four things, none of them "the network":

1. **Nothing awaited the response.** `void loadThread(true)` is fire-and-forget, so one
   cycle cost a render (microseconds), not a round-trip. The loop ran at *render* speed.
   Had it awaited, it would have been ~10/sec and probably gone unnoticed for weeks.
2. **Failure was faster than success.** Once RingCentral refused, the gateway 502'd
   immediately — no upstream call, no body. The loop *accelerated* as it degraded.
3. **No limiter existed anywhere in the path** — no debounce, no in-flight guard, no
   `AbortController`, no client rate limit, and no gateway rate limit.
4. **The only brake was the browser running out of sockets**
   (`ERR_INSUFFICIENT_RESOURCES`), which means the 7,298 console errors *undercount*
   the attempts.

## 3. Why nothing caught it

| Guard | Why it didn't fire |
|---|---|
| `react-hooks/exhaustive-deps` | **It required the object in the deps.** The rule that exists to catch bugs is what produced this one. The other two texting surfaces (`ConversationThread`, `mmKit`) suppress the rule and key on `[phone]`/`[open]` — neither was affected. |
| React's loop detector | Never fires. "Maximum update depth exceeded" is for nested-update cascades; here each run's deps *genuinely changed*, so React considers it legitimate. It reproduces as a **hang, not an error**. |
| Tests | No component render test existed for this card. `useDeliveryRecheck` had no test at all. |
| CI typecheck | Vacuous — see §6. |
| The gateway | Forwarded everything. It held credentials to a shared production phone system with no ceiling of any kind. |
| The monitor | **Actively misled us** — see §5. |

## 4. Why prod broke without having the bug

`sync-from-test` is manual, so prod's bundle never contained `ed8e33e`. But per
[CLAUDE.md §8](CLAUDE.md), **one gateway and one RingCentral app serve both SPAs**.
Prod inherited the throttle with entirely innocent code.

> Test and prod share every backend. A test-only bug is not a test-only blast radius.

## 5. The monitor sent us the wrong way for 40 minutes

`calls-monitor` read a null `subscriptionId` as proof no subscription existed and paged
**"No RingCentral subscription exists — no calls will arrive."**

That is the *gateway's* memory, not RingCentral's record. It is per-process and filled
by a reconcile pass that can fail for unrelated reasons — a 429 on the lookup being the
one that happened. A redeploy at 17:58 plus a throttled first pass emptied it while
RingCentral was still delivering webhooks to that same container.

So the first ~40 minutes were spent investigating an inbound-call outage that did not
exist, while the actual fault — a render loop in a text-message card — was three hours
old and still running.

Two latent bugs surfaced by that:
- `faults()` asserted an outage it had not established.
- A failed reconcile had **no retry** (boot + hourly only), so one transient 429 cost a
  full hour of the gateway not knowing its own subscription.

## 6. Fixed

| Commit | Fix |
|---|---|
| `4e3c5ea` | The loop. Hook memoizes its result; the card depends on the stable function. 5 regression tests, incl. a **circuit breaker** — without one the bug reproduces as CI *hanging*, which is worse than no test. |
| `65f2ce9` | `faults()` now says what it can support: webhooks arriving ⇒ alive; a stated error ⇒ "could not confirm"; only a null id with no reason keeps the blunt verdict. Plus a bounded reconcile retry ladder (30s·1m·2m·4m·8m, honouring `Retry-After`). |
| `4300fac` | **`rcLimiter.mjs`** — coalescing, per-caller + global budget, and a 429 circuit breaker on every RingCentral call. Tiered so a *ringing call forward* and a *rep's text* are never shed. `rcApiFetch.test.mjs` replays the real attack: 500 concurrent identical requests ⇒ **1** upstream call. |
| (this commit) | `useStediRun` and `useMondayFiles` memoized — the same shape, found by auditing for it. `useStediRun` is consumed as `useEffect(…, [selected, stedi])` and did not loop **only** because `observe` returns before any `setState` unless a check is running. One line from a repeat. |

## 7. Still open

- **CI's typecheck is a no-op.** `deploy.yml` runs `npx tsc --noEmit`, but the root
  tsconfig is solution-style (`"files": []` + project references), which `--noEmit` does
  not follow — so it checks **zero files and always exits 0**. There are 23 real TS
  errors in the tree right now. Found in `081b060`; not yet fixed.
- **No lint rule** catches "custom hook returns an unmemoized object". The audit that
  found the two above was a one-off script, not a check that runs.
- **The SPA still has no client-side guard.** Only the gateway now stops a runaway
  component, which means the *next* one still burns the user's browser and shows errors —
  it just can't take RingCentral down with it.

## 8. Rules this bought

1. **A shared resource with no limiter will be exhausted.** The gateway holds credentials
   to a production phone system used by two deployments; "the client will behave" is not
   a design.
2. **`exhaustive-deps` satisfied is not `exhaustive-deps` safe.** If a hook's return value
   goes in a dep array, that value must be memoized. Fix the hook, not just the caller —
   depending on the whole object is the natural thing to write and must therefore be safe.
3. **Fire-and-forget inside an effect is a rate multiplier.** An awaited loop is bounded by
   the network; an unawaited one is bounded by nothing.
4. **An alert must not assert what it has not established.** A false outage costs more than
   silence, because it teaches everyone to swipe the alerts away.
5. **Symptoms surface where the shared dependency is, not where the bug is.** The first
   report was about inbound calls. The bug was in a text-message card, three hours earlier.
