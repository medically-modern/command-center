/**
 * The Fax tab's view filter — Unread · Received · Sent · Failed.
 *
 * Pure. Mirrors the menu RingCentral's own app offers (Josh, 2026-09-02), so a
 * rep moving between the two doesn't have to relearn the pane.
 *
 * ⚠️ **Two different sources, and the filter is what decides which.** Received
 * and Unread read the INBOUND list the tab already loads; Sent and Failed read
 * the OUTBOUND one, which is fetched only while one of those two is chosen. A
 * rep on the default view never spends a request on faxes they didn't ask to
 * see — the same posture as "only the open tab polls".
 */
import { buildFaxOutcomes, faxKey, type FaxOutcome, type RcFaxRecord } from "../fax/faxOutcome";
import type { InboundFax } from "../fax/ringcentralApi";

export type FaxView = "all" | "unread" | "received" | "sent" | "failed";

export const FAX_VIEWS: { id: FaxView; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "received", label: "Received" },
  { id: "sent", label: "Sent" },
  { id: "failed", label: "Failed" },
];

/** Does this view read the outbound list? Drives whether it is fetched at all. */
export function viewIsOutbound(view: FaxView): boolean {
  return view === "sent" || view === "failed";
}

/**
 * One outbound fax, flattened to the shape the list renders.
 *
 * ⚠️ RingCentral reports an outbound fax's verdict PER RECIPIENT, so a record
 * with several `to` entries is several rows here. Collapsing to the parent
 * would report one number's failure as the whole send's, or hide it entirely —
 * the same "read the legs, not the summary" rule the call log needs (§5.16).
 */
export interface OutboundFaxRow {
  id: number;
  /** Unique per RECIPIENT — one record fanned out to three numbers is three
   *  rows, and React needs them told apart. */
  key: string;
  /** Who we sent it TO — the counterpart of an inbound fax's `from`. */
  number: string;
  name: string;
  creationTime: string;
  pages: number;
  state: FaxOutcome["state"];
  /** RingCentral's `faxErrorCode`, when it gave one for a failure. */
  code?: string;
}

export function toOutboundRows(records: RcFaxRecord[]): OutboundFaxRow[] {
  const outcomes = buildFaxOutcomes(records ?? []);
  const rows: OutboundFaxRow[] = [];
  for (const rec of records ?? []) {
    for (const to of rec.to ?? []) {
      const key = faxKey(to.phoneNumber);
      if (!key) continue;
      const o: FaxOutcome | undefined = outcomes.get(key);
      rows.push({
        id: Number(rec.id ?? 0),
        key: `${rec.id ?? 0}:${key}`,
        number: String(to.phoneNumber ?? ""),
        name: String(to.name ?? "").trim(),
        creationTime: String(rec.creationTime ?? ""),
        pages: Number(rec.faxPageCount ?? 0),
        state: o?.state ?? "sent",
        ...(o?.code ? { code: o.code } : {}),
      });
    }
  }
  return rows.sort((a, b) => new Date(b.creationTime).getTime() - new Date(a.creationTime).getTime());
}

/** Inbound faxes for the views that read them. `sent`/`failed` render nothing
 *  from this list — they are outbound by definition. */
export function filterInbound(faxes: InboundFax[], view: FaxView): InboundFax[] {
  if (viewIsOutbound(view)) return [];
  if (view === "unread") return faxes.filter((f) => !f.read);
  return faxes;
}

/** Outbound rows for the views that read them. */
export function filterOutbound(rows: OutboundFaxRow[], view: FaxView): OutboundFaxRow[] {
  if (view === "failed") return rows.filter((r) => r.state === "failed");
  if (view === "sent") return rows;
  return [];
}
