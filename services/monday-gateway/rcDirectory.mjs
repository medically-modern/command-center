/**
 * The account's extensions — number → person — for naming who picked up an
 * inbound call (callArchiveRules.answeredByOf, CLAUDE.md §5.47d).
 *
 * A call-log fan-out leg carries the extension NUMBER that answered and no
 * name, so the archive resolves the name here. The list changes when somebody
 * is hired or leaves, so one read every six hours is plenty: four RingCentral
 * requests a day, on the `background` tier that is shed first.
 *
 * ⚠️ NEVER THROWS, and never blocks the archive on a failed read. A call is
 * archived with its extension number whether or not a name could be found;
 * the upsert fills the name in on a later scan (it never blanks a known one).
 * A failed read is retried after ten minutes, not on every capture tick — the
 * tick runs every minute, and a retry loop against a throttled account is how
 * a throttle is kept alive (§5.47).
 */
import { rcApiFetch, rcConfigured } from "./ringcentral.mjs";
import { EMPTY_DIRECTORY, extensionDirectory } from "./callArchiveRules.mjs";

const TTL_MS = 6 * 60 * 60_000;
const RETRY_MS = 10 * 60_000;

let cached = null;
let cachedAt = 0;
let failedAt = 0;
let inflight = null;

export async function getExtensionDirectory() {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return cached;
  if (!rcConfigured()) return cached ?? EMPTY_DIRECTORY;
  if (failedAt && now - failedAt < RETRY_MS) return cached ?? EMPTY_DIRECTORY;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await rcApiFetch(
        "/restapi/v1.0/account/~/extension?perPage=250",
        {},
        { tier: "background", caller: "rc-directory" },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(body?.records)) {
        failedAt = Date.now();
        return cached ?? EMPTY_DIRECTORY;
      }
      cached = extensionDirectory(body.records);
      cachedAt = Date.now();
      failedAt = 0;
      return cached;
    } catch {
      failedAt = Date.now();
      return cached ?? EMPTY_DIRECTORY;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Counts only, for a health route: never a name. */
export function directoryHealth() {
  return {
    extensions: cached ? cached.byExt.size : 0,
    builtAt: cachedAt ? new Date(cachedAt).toISOString() : null,
    lastFailureAt: failedAt ? new Date(failedAt).toISOString() : null,
  };
}
