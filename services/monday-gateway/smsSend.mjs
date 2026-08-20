/**
 * The 5xx-but-delivered workaround for RingCentral SMS.
 *
 * ⚠️ This account's `POST /extension/~/sms` returns a bare `500 Internal Server
 * Error` while STILL ACCEPTING the message — it lands in the message store and
 * delivers ~30s later. Reproduced on two separate OAuth apps (CLAUDE.md §5.5),
 * so it is account-level, not app-record rot.
 *
 * Without this check a 5xx reads as failure, the rep re-sends, and the patient
 * is texted twice. So before reporting a send as failed, look for the message in
 * the store: exact text, right recipient, created since the POST.
 *
 * Kept in its own module — with the fetcher and the sleep injected — so it can
 * be unit-tested without a Postgres driver or six seconds of real waiting.
 * (messaging.mjs imports `pg`, which the repo-root test runner has no access to.)
 */

const last10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);

/** RingCentral's terminal failure statuses. Mirrors FAILED_STATUSES in
 *  src/lib/shared/smsDelivery.ts — two values, and the SPA owns every other
 *  reading of these fields (the carrier-code table lives only there). */
const FAILED_STATUSES = new Set(["SendingFailed", "DeliveryFailed"]);

/**
 * Did a just-sent message actually land, despite the error?
 *
 * Returns `{ accepted, failed, deliveryError }` rather than a bare boolean,
 * because "in the store" and "on its way" are not the same thing: RingCentral
 * accepts a message to an undeliverable number and only then marks it
 * `SendingFailed`. Reporting that as accepted (which a presence-only check
 * does) tells the rep their text is on its way to a number that can never
 * receive it.
 *
 * ⚠️ Best-effort ONLY, and deliberately so. This looks within a few seconds of
 * the POST, and a carrier rejection can take longer than that — so `failed`
 * catches the fast rejections and nothing more. The reliable surface for a late
 * failure is the THREAD, where every message carries its status
 * (`/messaging/conversation` → `src/lib/shared/smsDelivery.ts`). Do not treat
 * `failed: false` here as proof a text was delivered.
 *
 * @param rcFetch  (path) => Response-like, already authenticated
 * @param to       recipient in E.164
 * @param text     the exact body that was sent
 * @param sentAtMs when the POST went out; the lookback window starts a minute earlier
 */
export async function confirmSmsAccepted({
  rcFetch,
  to,
  text,
  sentAtMs = Date.now(),
  attempts = 3,
  delayMs = 2000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const NOT_FOUND = { accepted: false, failed: false, deliveryError: "" };
  const want = last10(to);
  if (!want || !text) return NOT_FOUND;
  const dateFrom = new Date(sentAtMs - 60_000).toISOString();
  const path =
    `/restapi/v1.0/account/~/extension/~/message-store` +
    `?messageType=SMS&direction=Outbound&phoneNumber=${encodeURIComponent(to)}` +
    `&dateFrom=${encodeURIComponent(dateFrom)}&perPage=20`;

  for (let attempt = 0; attempt < attempts; attempt++) {
    // The message takes a moment to appear, so wait BETWEEN tries rather than
    // giving up on the first miss.
    if (attempt > 0) await sleep(delayMs);
    try {
      const res = await rcFetch(path);
      if (!res || !res.ok) continue;
      const json = await res.json();
      const hit = (json.records ?? []).find(
        (r) =>
          // Exact text AND recipient. A near-match is not proof: two different
          // messages to the same patient in the same minute is ordinary, and
          // treating one as the other would suppress a genuine failure.
          (r.subject ?? r.text ?? "") === text &&
          (r.to ?? []).some((t) => last10(t.phoneNumber) === want),
      );
      if (hit) {
        // Status decides. `Queued`/`Sent` is the ordinary 5xx-quirk outcome —
        // accepted, on its way. Anything RingCentral has already given up on is
        // a send the rep must be told about, not a success.
        const failed = FAILED_STATUSES.has(String(hit.messageStatus ?? ""));
        return {
          accepted: !failed,
          failed,
          deliveryError: failed ? String(hit.deliveryErrorCode ?? "") : "",
        };
      }
    } catch {
      // A transient read failure is not evidence the send failed — retry, and
      // only report failure once we have genuinely looked and not found it.
    }
  }
  return NOT_FOUND;
}
