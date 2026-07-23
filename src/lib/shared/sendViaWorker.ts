/**
 * sendViaWorker — shared email/fax transport for the app's "send" panels.
 *
 * POSTs recipients/cc/subject/body/files to the Cloudflare worker
 * `/send-message` route (worker/src/index.js). A bare-number recipient becomes
 * `<digits>@rcfax.com`, which RingCentral converts to a fax; email recipients
 * are grouped into ONE message (To: all + Cc:), while each @rcfax recipient is
 * faxed individually. Extracted from SendRequestPanel.handleSend so Send
 * Request and the Submit-Auth "Fax to Payer" panel share one implementation
 * (the normalization/validation was previously copy-pasted across panels).
 */
import { getIdToken } from "@/lib/shared/auth";
import { FILE_PROXY_URL } from "@/lib/shared/mondayAssets";

/** Plain address: local@domain, no spaces / separators / display names. */
const ADDR = /^[^\s@,;<>]+@[^\s@,;<>]+$/;

export interface SendPayload {
  recipients: string[];
  cc: string[];
  subject: string;
  body: string;
  files: File[];
}

export interface SendResult {
  ok: boolean;
  sender?: string;
  results?: { to: string; ok: boolean; error?: string | null }[];
}

/** Client-side validation failure (bad/empty addresses, not signed in). The
 *  caller surfaces `.message` in a toast; nothing was sent. */
export class SendValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SendValidationError";
  }
}

/** Normalize a recipient list: an entry containing "@" is kept as-is (email or
 *  an already-formatted @rcfax address); a bare number becomes
 *  `<digits>@rcfax.com` (RingCentral turns that into a fax). Empty entries and
 *  a stray digit-less "@rcfax.com" are dropped. */
export function normalizeRecipients(recipients: string[]): string[] {
  return recipients
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => (r.includes("@") ? r : `${r.replace(/\D/g, "")}@rcfax.com`))
    .filter((r) => r !== "@rcfax.com");
}

/** Trim + drop empties from a Cc list (email-only; validated in sendViaWorker). */
export function cleanCc(cc: string[]): string[] {
  return cc.map((r) => r.trim()).filter(Boolean);
}

/**
 * Send an email/fax through the worker. Throws {@link SendValidationError} for
 * bad input (caller shows a toast, nothing sent) and a plain Error for
 * transport / partial-send failure (message lists the failed recipients).
 * Resolves only on a fully-confirmed send.
 */
export async function sendViaWorker(payload: SendPayload): Promise<SendResult> {
  const idToken = getIdToken();
  if (!idToken) {
    throw new SendValidationError("Sign in with your medicallymodern.com account to send.");
  }

  // Anything with "@" is sent as-is; a bare number becomes <digits>@rcfax.com.
  const to = normalizeRecipients(payload.recipients);
  if (!to.length) throw new SendValidationError("Add at least one recipient.");
  // One malformed address fails the WHOLE grouped email, so validate each.
  const badTo = to.filter((r) => !ADDR.test(r));
  if (badTo.length) {
    throw new SendValidationError(
      `Invalid recipient${badTo.length > 1 ? "s" : ""}: ${badTo.join(", ")}`,
    );
  }

  // Cc is email-only — a fax has no Cc, and an @rcfax address here would put
  // the fax gateway address in front of every human recipient.
  const ccList = cleanCc(payload.cc);
  const badCc = ccList.filter((r) => !ADDR.test(r) || /@rcfax\.com$/i.test(r));
  if (badCc.length) {
    throw new SendValidationError(
      `Cc must be a plain email address (no fax numbers): ${badCc.join(", ")}`,
    );
  }

  const fd = new FormData();
  fd.append("recipients", JSON.stringify(to));
  fd.append("cc", JSON.stringify(ccList));
  fd.append("subject", payload.subject || "");
  fd.append("body", payload.body || "");
  for (const f of payload.files) fd.append("files", f);

  const res = await fetch(`${FILE_PROXY_URL}/send-message`, {
    method: "POST",
    headers: { "X-MM-Auth": idToken },
    body: fd,
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    sender?: string;
    results?: { to: string; ok: boolean; error?: string | null }[];
    error?: string;
  };
  if (!res.ok || !data.ok) {
    const failed = (data.results || []).filter((r) => !r.ok);
    throw new Error(
      failed.length
        ? failed.map((r) => `${r.to}: ${r.error || "failed"}`).join("; ")
        : data.error || `HTTP ${res.status}`,
    );
  }
  return { ok: true, sender: data.sender, results: data.results };
}
