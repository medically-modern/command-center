/**
 * One row per PATIENT in the global search, not one per board item (§5.42).
 *
 * Josh, 2026-09-21, searching a real patient: *"i searched her in the top
 * profile and all of her profiles poped up when only her name should pop up …
 * her active profile is welcome call, so that should be what pops up / that
 * stuck profile should also be accessable"*.
 *
 * ⚠️ **A patient is one item PER BOARD (§6), so a name legitimately returns
 * three to six rows** — the finished Profile Send Off record, the finished
 * Medical Evaluation record, the live Insurance one, and a duplicate or two
 * where a stage ran twice. The measured case had **six**: two completed Profile
 * Send Off items, a completed and an escalated Medical Evaluation item, a
 * completed Insurance item and one live Welcome Call item. In a flat list a rep
 * clicks the first row carrying the name, which is why §7 foldered the System
 * Management search in the first place. The header's drop-down has eight rows
 * total, so six of them being one person is worse than a folder: it crowds out
 * everybody else who matched.
 *
 * ⚠️ **Nothing is dropped — it is FOLDED.** Every row stays on the hit as
 * `rows`, and the one click opens the patient screen, whose stepper carries
 * every record the patient has on each stage with a tab per record (§5.39b).
 * So the completed snapshots and the stuck record are all one click further in
 * rather than one click away. That is the whole reason this is safe to do here
 * and would NOT be safe in a list that opened a stage page.
 */
import { personKey } from "@/lib/commsHub/dossier";
import { pipelineIndex } from "@/lib/commsHub/pipelineOrder";
import { searchBucket, type SearchBucket } from "@/lib/systemMgmt/searchBuckets";
import type { SystemPatient } from "@/lib/systemMgmt/mondayApi";

export interface PersonHit {
  /** Stable across polls — the grouping key, not an index. */
  key: string;
  name: string;
  phone: string;
  /** The record a click opens. */
  lead: SystemPatient;
  /** Every record folded into this person, lead first. */
  rows: SystemPatient[];
  /** The LEAD's bucket, which is what the row's badge says. */
  bucket: SearchBucket;
}

/** The last ten digits — the only substring present in every rendering of a
 *  number on these boards (§5.13's `findPatientByPhone` rule). */
export function last10(phone: string): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

/**
 * ⚠️⚠️ **A NAME IS NOT AN IDENTITY, so a row with no phone stands alone.**
 * `commsHub/dossier.nameMatchAccepted` requires a second signal before two
 * records may be called one person — the phone agrees, or the phone is blank
 * and the DOB agrees — and `SystemPatient` carries **no DOB**, so the second
 * branch is simply not available here. Two patients called Maria Garcia is
 * ordinary at this size; folding them would show ONE row and make the other
 * unreachable from the search, which is strictly worse than showing two.
 * Over-splitting costs a duplicate-looking row a rep can tell apart from the
 * stage beside it. Fail closed.
 *
 * ⚠️ **Orders never fold.** A New Order Board row is not a patient record — it
 * opens `/orders`, one item per reorder (§5.35) — so each keeps its own key and
 * the Orders folder behaves exactly as it did.
 */
export function groupKeyFor(row: SystemPatient): string {
  if (searchBucket(row) === "orders") return `order:${row.id}`;
  const digits = last10(row.phone);
  const name = personKey(row.name);
  if (!digits || !name) return `alone:${row.id}`;
  return `p:${name}|${digits}`;
}

/** Bucket order for picking the lead: a live record beats a stuck one, which
 *  beats a finished one. `orders` never reaches this — it never groups. */
const BUCKET_RANK: Record<SearchBucket, number> = { active: 3, stuck: 2, completed: 1, orders: 0 };

/**
 * Which of a person's records the row opens.
 *
 * ⚠️ **The ACTIVE one, furthest along** — Josh: *"her active profile is welcome
 * call, so that should be what pops up"*. A patient with no live record opens
 * on the stuck one if there is one (a manager decision is the actionable
 * thing), and otherwise on the furthest-along completed record, which is where
 * their history ends.
 */
export function pickLead(rows: readonly SystemPatient[]): SystemPatient {
  let best = rows[0];
  let bestScore = -1;
  for (const r of rows) {
    // Rank dominates the pipeline position, so a live Insurance record beats a
    // completed Welcome Call one: being worked outranks having been finished.
    const score = BUCKET_RANK[searchBucket(r)] * 100 + (pipelineIndex(r.boardId) + 1);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Fold search rows into people, keeping the order the first row of each person
 * arrived in.
 *
 * ⚠️ That order is `rankLiveResults`' (§7), so the best-matching person still
 * leads. Re-sorting here would throw away the ranking the search just did.
 */
export function groupSearchHits(rows: readonly SystemPatient[]): PersonHit[] {
  const order: string[] = [];
  const byKey = new Map<string, SystemPatient[]>();
  for (const row of rows) {
    const key = groupKeyFor(row);
    const list = byKey.get(key);
    if (list) list.push(row);
    else {
      byKey.set(key, [row]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const group = byKey.get(key)!;
    const lead = pickLead(group);
    return {
      key,
      lead,
      // Lead first, then the rest in the order they arrived — the caption reads
      // "and N more", so which N is stable between polls.
      rows: [lead, ...group.filter((r) => r !== lead)],
      name: lead.name || group.find((r) => r.name)?.name || "",
      phone: lead.phone || group.find((r) => r.phone)?.phone || "",
      bucket: searchBucket(lead),
    };
  });
}

/** The line under the name. Says what the patient is DOING, then how much
 *  history folded in — a bare "6 records" without the stage is a number with no
 *  meaning, and the stage without the count hides that there is more to see. */
export function hitCaption(hit: PersonHit): string {
  const stage = hit.lead.pipelineStage || hit.lead.groupTitle || hit.lead.boardName;
  const extra = hit.rows.length - 1;
  if (extra <= 0) return stage;
  return `${stage} · +${extra} more record${extra === 1 ? "" : "s"}`;
}
