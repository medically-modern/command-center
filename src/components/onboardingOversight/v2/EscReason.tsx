/**
 * Why escalated (Josh, 2026-10-02): the reason the escalating person wrote, read LIVE for a list's escalated rows only
 * and held in this hook's state — never on a row, never in the dashboard's cache (CR-17). Shared by the patient lists
 * and Janelle's and Katie's working lists.
 */
import { useEffect, useMemo, useState } from "react";
import type { V2Row } from "@/lib/onboardingOversight/v2/model";
import { SOURCE_LABEL, type EscReason, type ReasonSource } from "@/lib/onboardingOversight/v2/escReason";

/** Reads the escalation reasons for the given rows (live: fetchEscReasons). Absent offline, where notes are not read. */
export type LoadReasons = (rows: { key: string; boardKey: string; itemId: string }[]) => Promise<Record<string, EscReason>>;
export const REASON_ORDER: ReasonSource[] = ["proposedStuck", "escalated", "escalatedToFinal", "autoEscalated", "dropdown", "edgeCase", "none"];

/** undefined = reading; null = the read failed. `whyOf` is null for a row with the processor or not yet read. */
export function useEscReasons(rows: V2Row[], load: LoadReasons | undefined) {
  const escRows = useMemo(() => rows.filter((r) => r.escType != null), [rows]);
  const [reasons, setReasons] = useState<Record<string, EscReason> | null | undefined>(undefined);
  const escKey = escRows.map((r) => r.key).join(","); // the page rebuilds `rows` on every render; read again only when the set changes
  useEffect(() => {
    if (!load || !escRows.length) return;
    let on = true; setReasons(undefined);
    load(escRows.map((r) => ({ key: r.key, boardKey: r.boardKey, itemId: r.itemId }))).then((x) => { if (on) setReasons(x); }, () => { if (on) setReasons(null); });
    return () => { on = false; };
  }, [load, escKey]); // eslint-disable-line react-hooks/exhaustive-deps -- escRows is keyed by escKey
  const whyOf = (r: V2Row): EscReason | null => (r.escType != null && reasons ? reasons[r.key] ?? null : null);
  const bySource = reasons ? REASON_ORDER.map((src) => ({ src, n: escRows.filter((r) => (reasons[r.key]?.source ?? "none") === src).length })).filter((x) => x.n) : [];
  return { escRows, reasons, whyOf, bySource, live: !!load };
}

/** The cell: the words as written, then where they came from, when, and by whom. */
export function WhyCell({ row, state }: { row: V2Row; state: ReturnType<typeof useEscReasons> }) {
  if (row.escType == null) return null;
  if (!state.live) return <span className="tt-muted-inline">Read live in Command Center</span>;
  if (state.reasons === undefined) return <span className="tt-muted-inline">Reading…</span>;
  if (state.reasons === null) return <span className="tt-muted-inline">Could not read the notes</span>;
  const w = state.whyOf(row);
  if (!w || w.source === "none") return <><span className="tt-why tt-muted-inline">No reason written</span><span className="tt-muted">Likely a Monday automation{w?.earlier ? " · returned since" : ""}</span></>;
  const meta = [SOURCE_LABEL[w.source], w.date, w.by].filter(Boolean).join(" · ");
  return <><span className="tt-why" title={w.text}>{w.text || <span className="tt-muted-inline">(no words after the stamp)</span>}</span>
    <span className="tt-muted">{meta}{w.earlier ? " · written before a later return" : ""}</span></>;
}
