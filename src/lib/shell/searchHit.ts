/**
 * WHICH field a search row matched on — the caption at the right of a header
 * search row: "Member ID <b>W123…</b>", "Doctor phone <b>…</b>", "Tracking
 * <b>1Z…</b>". Brandon's `searchPatients` decides it this way, and this is his
 * precedence, kept exactly (§5.52):
 *
 *   digits:  Phone → DOB → Member ID → Doctor phone → Order # → PO # → Tracking
 *   text:    Name → Member ID → Doctor (name or clinic) → Insurance → PO #
 *   a date:  DOB
 *
 * ⚠️ **A NAME match prints NOTHING** — his `r.hit[0]==='Name'?''` — because the
 * name is the row. Every other match is on a field the row does not otherwise
 * show, and the caption is the only thing telling a rep WHY this patient is
 * in the list. Without it a Humana query returning forty names reads as the
 * search misfiring (the same rule `matchedBy` follows).
 *
 * ⚠️ Worked out from the FETCHED values, over every record folded into the
 * person (§5.42) — the record that matched is often not the lead. The
 * Insurance record carries the member id; the lead is the live Welcome Call
 * one. Monday matched server-side; this only explains.
 *
 * ⚠️ Pure. A row with no `fields` (a board declaring none) contributes only its
 * phone and DOB, and a match nothing here can explain returns null: the row
 * still stands, uncaptioned, rather than being dropped or given a made-up
 * reason.
 */
import {
  liveSearchRules,
  phoneNeedlesFor,
  type SystemPatient,
} from "@/lib/systemMgmt/mondayApi";

export interface SearchHit {
  /** "Member ID", "Doctor", "Doctor phone", "Insurance", "DOB", "Phone", "Order #", "PO #", "Tracking". */
  label: string;
  /** The board's own value, as stored — never reformatted. */
  value: string;
}

const digitsOf = (s: string) => String(s ?? "").replace(/\D/g, "");
const lower = (s: string) => String(s ?? "").toLowerCase();

/** The number a rep typed, needing this many digits before a member id counts
 *  (`FIELD_MIN_MEMBER_DIGITS` — four, Brandon's own floor). Re-declared rather
 *  than imported so this file's rule reads in one place; `searchHit.test.ts`
 *  pins the two equal. */
export const HIT_MIN_MEMBER_DIGITS = 4;

export function searchHit(rows: readonly SystemPatient[], query: string): SearchHit | null {
  const rules = liveSearchRules(query);
  if (!rules || !rows.length) return null;

  if (rules.kind === "dob") {
    const r = rows.find((row) => rules.needles.some((n) => String(row.dob ?? "").includes(n)));
    return r ? { label: "DOB", value: r.dob } : null;
  }

  if (rules.kind === "phone") {
    const qd = rules.digits;
    const needles = phoneNeedlesFor(qd);
    const holds = (v: string) => {
      const d = digitsOf(v);
      return needles.some((n) => d.includes(n));
    };
    for (const r of rows) if (holds(r.phone)) return { label: "Phone", value: r.phone };
    if (qd.length >= HIT_MIN_MEMBER_DIGITS) {
      for (const r of rows) if (digitsOf(r.dob).includes(qd)) return { label: "DOB", value: r.dob };
      for (const r of rows) {
        const m = r.fields?.memberIds.find((v) => digitsOf(v).includes(qd));
        if (m) return { label: "Member ID", value: m };
      }
    }
    for (const r of rows) {
      const p = r.fields?.doctorPhones.find(holds);
      if (p) {
        const doctor = r.fields?.doctors[0];
        return { label: "Doctor phone", value: doctor ? `${doctor} · ${p}` : p };
      }
    }
    for (const r of rows) {
      const f = r.fields;
      if (!f) continue;
      const o = f.orderNumbers.find((v) => digitsOf(v).includes(qd));
      if (o) return { label: "Order #", value: o };
      const po = f.poNumbers.find((v) => digitsOf(v).includes(qd));
      if (po) return { label: "PO #", value: po };
      const t = f.trackingNumbers.find((v) => digitsOf(v).includes(qd));
      if (t) return { label: "Tracking", value: t };
    }
    return null;
  }

  // A name query. Every word inside some record's name is a NAME match, and a
  // name match prints nothing.
  const terms = rules.terms.map(lower);
  if (rows.some((r) => terms.every((t) => lower(r.name).includes(t)))) return null;
  const phrase = terms.join(" ");
  const has = (v: string) => lower(v).includes(phrase);
  for (const r of rows) {
    const f = r.fields;
    if (!f) continue;
    const m = f.memberIds.find(has);
    if (m) return { label: "Member ID", value: m };
    const d = f.doctors.find(has);
    if (d) return { label: "Doctor", value: d };
    const c = f.clinics.find(has);
    if (c) return { label: "Doctor", value: c };
    const i = f.insurances.find(has);
    if (i) return { label: "Insurance", value: i };
    const po = f.poNumbers.find(has);
    if (po) return { label: "PO #", value: po };
  }
  return null;
}
