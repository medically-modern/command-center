/**
 * How the Supabase board page draws a cell the way monday does
 * (docs/claude/5.55 *The board page*). Pure — no React, no fetching.
 */
import type { MirrorBoard, MirrorCell, MirrorItem } from "./boardApi";

/** monday's blank status: the grey cell with no text. */
export const BLANK_STATUS_HEX = "#c4c4c4";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A monday date cell's text ("2026-09-28" or "2026-09-28 14:30") the way the
 * board shows it: "Sep 28", with the year only when it isn't this year and the
 * time only when there is one. ⚠️ Read by its date PARTS, never `new Date()` —
 * monday dates are Eastern with no zone (CLAUDE.md §9).
 */
export function formatMondayDate(text: string | undefined, todayYmd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(String(text ?? "").trim());
  if (!m) return String(text ?? "");
  const [, y, mo, d, hh, mm] = m;
  const month = MONTHS[Number(mo) - 1];
  if (!month) return String(text);
  let out = `${month} ${Number(d)}`;
  if (y !== todayYmd.slice(0, 4)) out += `, ${y}`;
  if (hh != null) {
    const h = Number(hh);
    out += `, ${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
  }
  return out;
}

/** "15555550100" / "5555550100" → "(555) 555-0100"; anything else as monday gave it. */
export function formatPhone(text: string | undefined): string {
  const raw = String(text ?? "");
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : raw;
}

/** A status cell's colour: its label's own hex, monday's grey when blank or unknown. */
export function statusHex(labels: MirrorBoard["labels"], columnId: string, cell: MirrorCell | undefined): string {
  if (cell?.i == null) return BLANK_STATUS_HEX;
  return labels[columnId]?.[String(cell.i)]?.hex || BLANK_STATUS_HEX;
}

/** The columns at least one item has a value in — the default "hide empty columns" view. */
export function columnsWithData(items: MirrorItem[]): Set<string> {
  const s = new Set<string>();
  for (const it of items) for (const id of Object.keys(it.cells)) s.add(id);
  return s;
}

/** monday's board search: the item name or any cell's text, ignoring case. */
export function matchesSearch(item: MirrorItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (item.name.toLowerCase().includes(q)) return true;
  return Object.values(item.cells).some((c) => (c.t ?? "").toLowerCase().includes(q));
}

export interface BatterySegment {
  key: string;
  label: string;
  hex: string;
  count: number;
}

/**
 * monday's status "battery" under a group: one segment per label in use,
 * widest first, blanks last and grey.
 */
export function batterySegments(labels: MirrorBoard["labels"], columnId: string, items: MirrorItem[]): BatterySegment[] {
  const by = new Map<string, BatterySegment>();
  for (const it of items) {
    const c = it.cells[columnId];
    const key = c?.i == null ? "blank" : String(c.i);
    const seg = by.get(key) ?? {
      key,
      label: key === "blank" ? "Blank" : labels[columnId]?.[key]?.label ?? c?.t ?? "",
      hex: key === "blank" ? BLANK_STATUS_HEX : statusHex(labels, columnId, c),
      count: 0,
    };
    seg.count++;
    by.set(key, seg);
  }
  return [...by.values()].sort((a, b) => (a.key === "blank" ? 1 : b.key === "blank" ? -1 : b.count - a.count));
}

/** "just now" / "4 min ago" / "3 h ago" — how fresh the copy is. */
export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "never";
  const min = Math.floor((now - t) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.floor(h / 24)} days ago`;
}

/** Column widths by monday type, in px — roughly monday's own defaults. */
export function columnWidth(type: string): number {
  switch (type) {
    case "status": return 140;
    case "date": return 120;
    case "numbers": return 100;
    case "file": return 90;
    case "phone": return 150;
    case "email": return 210;
    case "dropdown": return 190;
    case "long_text":
    case "location": return 230;
    default: return 170;
  }
}
