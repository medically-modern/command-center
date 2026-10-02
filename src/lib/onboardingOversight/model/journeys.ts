/**
 * Patient journeys across boards (BUILD-SPEC §3.2.4, §3.3). Board hops are copies with new item IDs,
 * so the only join is the Patient UID. Primary item per board = earliest created; others are duplicates.
 */
import type { Dict } from "../types";
import type { ArrivalSource, ItemRow, Journey, RawEvent } from "../types";
import { OO_CONFIG } from "../config";
import { etMidnight } from "../time/businessTime";

type Cfg = typeof OO_CONFIG;
export const patientKey = (it: ItemRow) => it.uid ?? `item:${(OO_CONFIG.boards as Dict)[it.boardKey]}:${it.itemId}`;

function inImportWindow(it: ItemRow, cfg: Cfg): boolean {
  return cfg.importWindows.some((w) => w.board === it.boardKey && it.createdAtMs >= Date.parse(w.from) && it.createdAtMs < Date.parse(w.to));
}

export function buildJourneys(items: ItemRow[], events: RawEvent[], cfg: Cfg = OO_CONFIG): Journey[] {
  const byKey = new Map<string, ItemRow[]>();
  const intByUid = new Map<string, ItemRow[]>();
  for (const it of items) {
    if (it.boardKey === "INT") { if (it.uid) (intByUid.get(it.uid) ?? intByUid.set(it.uid, []).get(it.uid)!).push(it); continue; }
    if (!["MN", "INS", "WC"].includes(it.boardKey)) continue;
    const k = patientKey(it);
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(it);
  }
  // Release events: first WC stage -> released label, per WC item.
  const releaseByItem = new Map<string, number>();
  for (const e of events) {
    if (e.boardKey === "WC" && e.columnId === cfg.stageColumn.WC && e.toIndex === cfg.metricLabels.WC.released) {
      const prev = releaseByItem.get(e.itemId);
      if (prev == null || e.atMs < prev) releaseByItem.set(e.itemId, e.atMs);
    }
  }
  const journeys: Journey[] = [];
  for (const [k, list] of byKey) {
    const primary: Journey["primary"] = {};
    const duplicates: ItemRow[] = [];
    for (const it of [...list].sort((a, b) => a.createdAtMs - b.createdAtMs)) {
      if (!primary[it.boardKey]) primary[it.boardKey] = it; else duplicates.push(it);
    }
    const ints = k.startsWith("item:") ? [] : (intByUid.get(k) ?? []).sort((a, b) => a.createdAtMs - b.createdAtMs);
    if (ints[0]) primary.INT = ints[0];
    let arrivalMs: number | null = null; let arrivalSource: ArrivalSource = null;
    if (primary.INT) { arrivalMs = primary.INT.createdAtMs; arrivalSource = "int_uid"; }
    else if (primary.MN) { arrivalMs = primary.MN.createdAtMs; arrivalSource = "mn_created"; }
    else if (primary.WC?.values["date_mm1wf43j"]?.date) { arrivalMs = etMidnight(Date.parse(`${primary.WC.values["date_mm1wf43j"].date}T12:00:00Z`)); arrivalSource = "wc_date_of_intake"; }
    else { const first = list.reduce((a, b) => (a.createdAtMs < b.createdAtMs ? a : b)); arrivalMs = first.createdAtMs; arrivalSource = "first_item"; }
    let releaseMs: number | null = null;
    for (const it of list) if (it.boardKey === "WC") { const r = releaseByItem.get(it.itemId); if (r != null && (releaseMs == null || r < releaseMs)) releaseMs = r; }
    const ordered = [primary.INT, primary.MN, primary.INS, primary.WC].filter(Boolean) as ItemRow[];
    let referralSource: string | null = null;
    for (const it of ordered) {
      const idx = it.values[cfg.referralSourceColumn]?.index;
      if (idx != null) { referralSource = ((cfg.referralSourceLabels as Dict)[it.boardKey]?.[idx]) ?? null; if (referralSource) break; }
    }
    const expedited = [...list, ...ints].some((it) => it.values[(cfg.expeditedColumn as Dict)[it.boardKey]]?.index === cfg.expeditedLabel);
    const importCohort = ordered.length > 0 && inImportWindow(ordered[0], cfg);
    journeys.push({ patientKey: k, primary, duplicates, arrivalMs, arrivalSource, releaseMs, referralSource, expedited, importCohort });
  }
  return journeys;
}
