/**
 * Inbound fax → whose office sent it → which of our patients they look after.
 *
 * A fax arrives as a number and nothing else. The rep's real question is
 * "whose clinicals are these?", and answering it today means leaving the fax
 * inbox, guessing the practice, and searching patients one at a time. The
 * doctor fax number is already on every patient's board record, so the
 * question is answerable by joining on it.
 *
 * Pure. The Monday reads live in `dossierApi.ts`.
 *
 * ⚠️ **The Doctor Fax column is an EMAIL column holding `<digits>@rcfax.com`**
 * (`email_mm1xdzcj` on Profile Send Off / Medical Evaluation / Insurance /
 * Welcome Call, `email_mkxn9af2` on Subscription — see `shared/faxAddress.ts`
 * for why). So the join has to strip an address before it compares digits;
 * comparing the stored value to a phone number matches nothing, with no error.
 */
import { contactKey } from "../contactState/contactState";

/** The Medical Evaluation Stage Advancer value that means a rep is currently
 *  chasing this office for clinicals. Exact board label (§9). */
export const CHASE_STAGE_LABEL = "Chase Clinicals";
const MEDICAL_EVALUATION_BOARD = 18406060017;

/** One patient row matched to the sending office. */
export interface FaxPatient {
  itemId: string;
  name: string;
  boardId: number;
  boardName: string;
  groupTitle: string;
  /** Stage Advancer text, e.g. "Chase Clinicals". */
  stage: string;
  route: string;
  isCompleted: boolean;
  isStuck: boolean;
  /**
   * Being chased for clinicals RIGHT NOW — highlighted, because an arriving
   * fax is very likely the answer to that chase.
   */
  inChase: boolean;
  /** Fax · Parachute · Email · blank — which chase queue they are in (§5.9). */
  clinicalsMethod: string;
  nextActionDate: string;
}

/** What we know about the office, gathered from the matched patient rows. */
export interface FaxProvider {
  doctorName: string;
  clinicName: string;
  npi: string;
  phone: string;
  /** The stored fax value, as typed on the board. */
  fax: string;
}

export interface FaxDirectoryEntry {
  /** The number the fax came from, as RingCentral reported it. */
  faxNumber: string;
  /** Null when no patient on any board carries this fax number. */
  provider: FaxProvider | null;
  /** Active pipeline patients for this office, chase-first. */
  patients: FaxPatient[];
  /** Matched rows that are finished or stuck — counted, not listed. */
  inactiveCount: number;
}

/** A cross-board row as `dossierApi` returns it for this join. */
export interface FaxMatchRow {
  itemId: string;
  name: string;
  boardId: number;
  boardName: string;
  groupTitle: string;
  isCompleted: boolean;
  isStuck: boolean;
  route: string;
  stage: string;
  clinicalsMethod: string;
  nextActionDate: string;
  doctorName: string;
  clinicName: string;
  npi: string;
  doctorPhone: string;
  doctorFax: string;
}

/**
 * Digits of a stored Doctor Fax value.
 *
 * Handles both shapes the column holds: `8653742115@rcfax.com` (what the app
 * writes) and a bare number (what a rep typed before that convention, or into
 * Monday directly). Everything after an `@` is dropped first, so the digits in
 * a domain can never be mistaken for the number.
 */
export function faxDigits(stored: string): string {
  const local = String(stored ?? "").split("@")[0];
  return contactKey(local);
}

/** Is this patient being chased for clinicals right now? */
export function isChasing(row: { boardId: number; stage: string; isCompleted: boolean; isStuck: boolean }): boolean {
  return (
    row.boardId === MEDICAL_EVALUATION_BOARD &&
    row.stage.trim() === CHASE_STAGE_LABEL &&
    !row.isCompleted &&
    !row.isStuck
  );
}

/** The fullest doctor record among the matched rows.
 *
 *  Rows for one office disagree: a Welcome Call record may carry the doctor's
 *  name and nothing else while the Medical Evaluation record has the NPI and
 *  the clinic. Taking the first non-empty value per FIELD rather than the
 *  first row wholesale is what makes the card complete. */
function mergeProvider(rows: FaxMatchRow[]): FaxProvider | null {
  if (!rows.length) return null;
  const first = (pick: (r: FaxMatchRow) => string) => rows.map(pick).map((v) => (v || "").trim()).find(Boolean) || "";
  return {
    doctorName: first((r) => r.doctorName),
    clinicName: first((r) => r.clinicName),
    npi: first((r) => r.npi),
    phone: first((r) => r.doctorPhone),
    fax: first((r) => r.doctorFax),
  };
}

/**
 * Join an inbound fax number to the office and its patients.
 *
 * Ordering is the point of the list: patients being chased for clinicals come
 * first, because an arriving fax is most likely theirs. Within each group the
 * furthest-behind next action leads, so the oldest waiting patient is the first
 * name a rep reads.
 */
export function buildFaxDirectory(faxNumber: string, rows: FaxMatchRow[]): FaxDirectoryEntry {
  const want = contactKey(faxNumber);
  const matched = want.length === 10 ? rows.filter((r) => faxDigits(r.doctorFax) === want) : [];

  const active = matched.filter((r) => !r.isCompleted && !r.isStuck);
  // One patient can hold live items on two boards. The name is what a rep
  // reads, so collapse to the row that is most useful: a chase row wins.
  const byName = new Map<string, FaxPatient>();
  for (const r of active) {
    const p: FaxPatient = {
      itemId: r.itemId,
      name: r.name,
      boardId: r.boardId,
      boardName: r.boardName,
      groupTitle: r.groupTitle,
      stage: r.stage,
      route: r.route,
      isCompleted: r.isCompleted,
      isStuck: r.isStuck,
      inChase: isChasing(r),
      clinicalsMethod: r.clinicalsMethod,
      nextActionDate: r.nextActionDate,
    };
    const key = r.name.trim().toLowerCase();
    const prev = byName.get(key);
    if (!prev || (p.inChase && !prev.inChase)) byName.set(key, p);
  }

  const patients = [...byName.values()].sort((a, b) => {
    if (a.inChase !== b.inChase) return a.inChase ? -1 : 1;
    // A blank next-action date sorts FIRST among equals: nothing is scheduled,
    // so nothing will surface them on its own.
    const ad = a.nextActionDate || "";
    const bd = b.nextActionDate || "";
    if (!ad !== !bd) return ad ? 1 : -1;
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    faxNumber,
    provider: mergeProvider(matched),
    patients,
    inactiveCount: matched.length - active.length,
  };
}
