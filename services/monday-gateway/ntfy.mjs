/**
 * Minimal ntfy push, shared by anything on this gateway that needs to shout.
 *
 * Deliberately generic — the first caller is the send-job failure alert, but
 * the whole point of putting it here is that the next thing to monitor does not
 * need its own copy.
 *
 * ⚠️ THE TOPIC IS A SECRET AND LIVES IN A RAILWAY VARIABLE, NEVER IN THIS REPO.
 * An ntfy topic is a bearer capability: anyone who knows the string can read
 * every alert and publish fakes into it. `services/calls-monitor` already holds
 * this line (CLAUDE.md §5.13) and this follows it — NTFY_TOPIC and NTFY_URL are
 * env only. If either is unset the push is a silent no-op, so a local or
 * unconfigured deploy neither crashes nor pretends it alerted.
 *
 * ⚠️ NOTHING HERE MAY THROW INTO A CALLER. It is called from the send worker,
 * where an alert is a strictly smaller loss than the job it is reporting on —
 * the same fire-and-forget discipline `recordEvent` follows in inboundCalls.
 */

const NTFY_URL = process.env.NTFY_URL || "https://ntfy.sh";
const NTFY_TOPIC = process.env.NTFY_TOPIC || "";

export function ntfyConfigured() {
  return NTFY_TOPIC.length > 0;
}

/**
 * Push one notification. Never rejects; returns whether it went out.
 * `title`/`body` must already be PHI-safe — this does no redaction of its own.
 */
export async function postNtfy({ title, body, priority = "default", tags = "warning" }) {
  if (!ntfyConfigured()) return false;
  try {
    const res = await fetch(`${NTFY_URL.replace(/\/+$/, "")}/${NTFY_TOPIC}`, {
      method: "POST",
      headers: { Title: title, Priority: String(priority), Tags: tags },
      body,
    });
    if (!res.ok) {
      console.error(`ntfy failed (${res.status})`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("ntfy failed:", e.message);
    return false;
  }
}
