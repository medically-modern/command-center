/**
 * rcSetup.mjs — what the RingCentral ACCOUNT looks like right now (§5.13b).
 *
 * Built the day Josh started restructuring the account (2026-09-28: *"we are
 * adding lines so that katie victor masani and janelle will have their own
 * accounts and adding a phone tree — can you see that setup … from rc?"*).
 * Until now the answer was no: the /rc proxy allowlists only the SPA's own
 * reads (message-store · sms · ring-out · call-log, rcAllowlist.mjs) and every
 * §5.13b measurement of the account ("the whole team is ONE user, extension
 * 2") was a one-off hand query. This module makes the account's SHAPE
 * inspectable two ways:
 *
 *   · **A boot log.** Every deploy prints the summary, so Railway's deploy log
 *     carries a dated record of the account across the Route-A cutover — who
 *     has an extension, where each number sits, whether an IVR exists, and
 *     how many device records each extension has accreted.
 *   · **GET /calls/rc-setup?key=$AUDIT_KEY** — the same summary on demand,
 *     behind the same key door /calls/phone-health uses (it names employees'
 *     extensions, so it is not public; `key &&` so an unconfigured AUDIT_KEY
 *     is never an open door).
 *
 * ⚠️ Why this matters for the migration specifically: Route A's step 1
 * (§5.13b) requires the MAIN NUMBER to stay on extension 2 — texting
 * (RC_SMS_FROM must be a number on the JWT's extension), faxing, the webhook,
 * the call log and both archives all hang off it. A phone tree is usually
 * built by moving the main number onto an Auto-Receptionist/IVR, which would
 * strand every one of those. The `numbers` section below shows exactly which
 * extension each number belongs to and whether it can still send SMS — the
 * one reading that catches that mistake before patients stop getting texts.
 *
 * No PHI: extensions, company numbers and device counts are org structure.
 * Each section carries its own `error` instead of failing the whole read —
 * a permission the app lacks (ReadAccounts covers most of this) should say
 * so per section, not blank the parts it can see.
 */
import { rcApiFetch, rcConfigured } from "./ringcentral.mjs";

/** One RC list read, tolerant of missing permissions. `background` tier: this
 *  is diagnostics, and must never outrank a live call's traffic (§5.13). */
async function grab(path) {
  try {
    const res = await rcApiFetch(path, {}, { tier: "background", caller: "rc-setup" });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = body?.message || body?.errors?.[0]?.message || "";
      return { error: `RC ${res.status}${msg ? `: ${msg}` : ""}` };
    }
    return { records: Array.isArray(body?.records) ? body.records : [] };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

export async function describeRcSetup() {
  if (!rcConfigured()) return { configured: false };
  const [ext, nums, ivr, devices] = await Promise.all([
    grab("/restapi/v1.0/account/~/extension?perPage=250"),
    grab("/restapi/v1.0/account/~/phone-number?perPage=250"),
    grab("/restapi/v1.0/account/~/ivr-menus"),
    grab("/restapi/v1.0/account/~/device?perPage=250"),
  ]);

  const extensions = ext.error
    ? { error: ext.error }
    : ext.records.map((r) => ({
        ext: r.extensionNumber || "",
        name: r?.contact?.firstName ? `${r.contact.firstName} ${r.contact.lastName || ""}`.trim() : r.name || "",
        type: r.type || "",
        status: r.status || "",
      }));

  const numbers = nums.error
    ? { error: nums.error }
    : nums.records.map((r) => ({
        number: r.phoneNumber || "",
        usage: r.usageType || "",
        extension: r?.extension?.extensionNumber || r?.extension?.name || null,
        // The feature that decides whether RC_SMS_FROM keeps working if this
        // number is moved — see the header.
        smsSender: Array.isArray(r.features) ? r.features.includes("SmsSender") : null,
      }));

  const ivrMenus = ivr.error ? { error: ivr.error } : ivr.records.map((r) => r.name || r.id);

  let deviceSummary;
  if (devices.error) deviceSummary = { error: devices.error };
  else {
    // Counts per extension+type. The WebPhone count is the §5.13b scar: the
    // old provision-per-page-load minted a device record per load.
    const counts = new Map();
    for (const d of devices.records) {
      const key = `ext ${d?.extension?.extensionNumber || "?"} · ${d.type || "?"}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    deviceSummary = [...counts.entries()].sort().map(([k, n]) => `${k}: ${n}`);
  }

  return { configured: true, at: new Date().toISOString(), extensions, numbers, ivrMenus, devices: deviceSummary };
}

/** The boot log — compact, greppable, one section per line. */
export function logRcSetup() {
  if (!rcConfigured()) return;
  // Off the boot path: the subscription reconcile and schema come first, and
  // a diagnostics read must never slow either down.
  setTimeout(() => {
    void describeRcSetup()
      .then((s) => {
        if (!s.configured) return;
        const line = (v) => (v && v.error ? `error — ${v.error}` : JSON.stringify(v));
        console.log(`RC setup — extensions: ${line(s.extensions)}`);
        console.log(`RC setup — numbers: ${line(s.numbers)}`);
        console.log(`RC setup — ivrMenus: ${line(s.ivrMenus)}`);
        console.log(`RC setup — devices: ${line(s.devices)}`);
      })
      .catch((e) => console.error("RC setup read failed:", e.message));
  }, 20_000).unref?.();
}

/** GET /calls/rc-setup?key=… — the same summary on demand. */
export function registerRcSetup({ app }) {
  app.get("/calls/rc-setup", async (req, res) => {
    // The /calls/phone-health key door, for the same reason: this names
    // employees' extensions, and the reader may be a cron or a session with
    // no Google identity. `key &&` — an unconfigured AUDIT_KEY never opens it.
    const key = process.env.AUDIT_KEY || "";
    if (!key || req.query?.key !== key) return res.status(401).json({ error: "key required" });
    try {
      res.json(await describeRcSetup());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
