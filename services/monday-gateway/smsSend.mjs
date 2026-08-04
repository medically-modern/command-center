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

/**
 * Did a just-sent message actually land, despite the error?
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
  const want = last10(to);
  if (!want || !text) return false;
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
      const hit = (json.records ?? []).some(
        (r) =>
          // Exact text AND recipient. A near-match is not proof: two different
          // messages to the same patient in the same minute is ordinary, and
          // treating one as the other would suppress a genuine failure.
          (r.subject ?? r.text ?? "") === text &&
          (r.to ?? []).some((t) => last10(t.phoneNumber) === want),
      );
      if (hit) return true;
    } catch {
      // A transient read failure is not evidence the send failed — retry, and
      // only report failure once we have genuinely looked and not found it.
    }
  }
  return false;
}
