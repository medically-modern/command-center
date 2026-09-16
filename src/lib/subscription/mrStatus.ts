/**
 * Medical Records status — which rung the MR column should read for a given
 * MN Expiry date.
 *
 * ⚠️ THE BOARD'S OWN AUTOMATIONS ONLY EVER COUNT DOWN. Five date-arrival
 * automations on the Subscription board drive MR (`color_mktyr8xg`) off MN
 * Expiry (`date_mkp09gra`), and every one of them walks the status one rung
 * closer to expired:
 *
 *   637032587  30 days before MN Expiry, 12:00 ET  →  MR <30 Days
 *   637036882  20 days before,           12:00 ET  →  MR <20 Days
 *   637037259  10 days before,           12:00 ET  →  MR <10 Days
 *   637038815   5 days before,           12:00 ET  →  MR <5 Days
 *   637034292  on MN Expiry,             11:00 ET  →  MR Expired
 *
 * Nothing anywhere puts it BACK. No automation on that board sets MR Valid —
 * the only two that ever did are deactivated (one fired at item creation) —
 * and the SPA had never written the column at all. So a patient whose records
 * were refreshed kept reading "MR Expired": pushing MN Expiry six months out
 * re-arms the ladder, but the next rung to fire is the −30-day one, FIVE
 * MONTHS later, which sets "MR <30 Days". The patient sat on Expired for five
 * months and then jumped straight to "<30 Days", never passing through Valid.
 *
 * Reported by Brandon, 2026-09-15, having just fixed one by hand a minute
 * earlier: "when she updates MR, and updates the MR Expiry date, it's not
 * triggering the MR status back to MR Valid (it's staying MR Expired)". The
 * MR column's activity log for 1 Aug–16 Sep bears it out — 28 automation
 * writes, not one of them to MR Valid; the only two writes to MR Valid in the
 * window were Brandon, by hand, both "MR Valid ← MR Expired".
 *
 * `/update-clinicals` now closes the loop: the Update Visit Date save computes
 * the new MN Expiry and writes the matching rung with it (see
 * `mondayWrite.saveVisitDateVerified`), and the automations carry it down from
 * there.
 *
 * ⚠️ THE FULL LADDER, not just MR Valid. The ask was "set MR Valid when the
 * new date is more than 30 days out", which covers the everyday case — a
 * recent visit plus six months is always well past 30 days. But a visit more
 * than five months old lands INSIDE the ladder, and there the rungs it has
 * already passed will never fire for the new date either: a 25-day expiry
 * would sit on "MR Expired" for five days and then jump to "<20 Days". Writing
 * the rung the date actually implies is the same rule the automations
 * implement and fixes that tail the same way. Boundaries match them exactly:
 * at 30 days out the −30 automation has fired, so 30 reads "<30 Days" and only
 * 31+ reads Valid.
 */
import { etTodayYmd } from "@/lib/shared/profileStatus";

/**
 * Live label ids, read back from `color_mktyr8xg`'s `settings_str` on
 * 2026-09-16.
 *
 * ⚠️ NEVER INFER THESE. Monday assigns a status label's id when the label is
 * created and takes the lowest free slot, not display order — which is why the
 * ladder reads 0 · 3 · 4 · 6 rather than anything sequential. A write to an id
 * the column does not have is dropped at HTTP 200 with nothing in the logs
 * (CLAUDE.md §5.12 / §5.20 / §5.31c / §5.31d / §5.33 — this is the sixth
 * column it applies to), and here that failure reads exactly like the bug this
 * module exists to fix. `mrStatus.test.ts` pins them against
 * `workflow.MR_STATUS_OPTIONS`, which carries the same ids for the picker.
 */
export const MR_STATUS_INDEX = {
  days30: 0,
  valid: 1,
  expired: 2,
  days20: 3,
  days10: 4,
  days5: 6,
  /** Present on the board, written by nothing and held by no item (checked
   *  live, 2026-09-16: zero rows). A human judgement, not a date-derived
   *  state — so this module neither writes it nor treats it specially. */
  invalid: 7,
} as const;

export interface MrRung {
  index: number;
  label: string;
}

/** Whole days between two YYYY-MM-DD dates.
 *
 *  ⚠️ Both sides are read as UTC midnight so the subtraction is exact whole
 *  days. Monday's dates are timezone-naive ET (§9) and this runs in a UTC
 *  container as readily as in a browser in New York, so building a local
 *  `Date` from either string would drift the answer by one across midnight. */
function daysBetweenYmd(fromYmd: string, toYmd: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(fromYmd.trim());
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(toYmd.trim());
  if (!a || !b) return null;
  const from = Date.UTC(+a[1], +a[2] - 1, +a[3]);
  const to = Date.UTC(+b[1], +b[2] - 1, +b[3]);
  return Math.round((to - from) / 86_400_000);
}

/**
 * The rung `expiryYmd` implies, as of `todayYmd` (ET today by default).
 *
 * Returns null for an unparseable or missing date — the caller then writes no
 * status at all. ⚠️ That is deliberate and it is the safe direction: a date we
 * could not read is not evidence of anything, and guessing "Valid" from it
 * would assert that a patient's records are current on the strength of a parse
 * failure. Same rule as `patientDirectory.isOrphanRow` and the pending-advance
 * marker — act on positive evidence, let what we failed to read mean nothing.
 */
export function mrRungForExpiry(
  expiryYmd: string | null | undefined,
  todayYmd: string = etTodayYmd(),
): MrRung | null {
  if (!expiryYmd) return null;
  const days = daysBetweenYmd(todayYmd, expiryYmd);
  if (days === null) return null;

  if (days <= 0) return { index: MR_STATUS_INDEX.expired, label: "MR Expired" };
  if (days <= 5) return { index: MR_STATUS_INDEX.days5, label: "MR <5 Days" };
  if (days <= 10) return { index: MR_STATUS_INDEX.days10, label: "MR <10 Days" };
  if (days <= 20) return { index: MR_STATUS_INDEX.days20, label: "MR <20 Days" };
  if (days <= 30) return { index: MR_STATUS_INDEX.days30, label: "MR <30 Days" };
  return { index: MR_STATUS_INDEX.valid, label: "MR Valid" };
}
