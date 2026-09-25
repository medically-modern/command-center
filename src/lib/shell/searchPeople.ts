/**
 * One row per PATIENT in the global search, not one per board item (§5.42).
 *
 * Josh, 2026-09-21: *"i searched her in the top profile and all of her profiles
 * poped up when only her name should pop up … her active profile is welcome
 * call, so that should be what pops up / that stuck profile should also be
 * accessable"*. And again, 2026-09-22, still seeing several: *"when you search
 * for a patient, it's still showing up multiple profiles for a specific
 * patient. It should only be one profile"* · *"Shouldn't show the +4 more
 * records"*.
 *
 * ⚠️ **A patient is one item PER BOARD (§6), so a name legitimately returns
 * three to six rows** — the finished Profile Send Off record, the finished
 * Medical Evaluation record, the live Insurance one, and a duplicate or two
 * where a stage ran twice. In a flat list a rep clicks the first row carrying
 * the name, and the header's drop-down has eight rows in total, so six of them
 * being one person crowds out everybody else who matched.
 *
 * ⚠️ **Nothing is dropped — it is FOLDED.** Every record stays on the hit as
 * `rows`, and the one click opens the patient screen, whose stepper carries
 * every record the patient has on each stage with a tab per record (§5.39b).
 * The completed snapshots and the stuck record are one click further IN rather
 * than one click away, which is what makes folding safe here and would not make
 * it safe in a list that opened a stage page.
 */
import { dobKey, personKey } from "@/lib/commsHub/dossier";
import { pipelineIndex } from "@/lib/commsHub/pipelineOrder";
import { searchBucket, type SearchBucket } from "@/lib/systemMgmt/searchBuckets";
import { SUBSCRIPTION_BOARD } from "@/lib/patient/patientScreen";
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
 * The coarse bucket a record can possibly fold into: its NAME.
 *
 * ⚠️ **Orders never fold.** A New Order Board row is not a patient record — it
 * opens `/orders`, one item per reorder (§5.35) — so each keeps its own key and
 * the Orders folder behaves exactly as it did. A record with no usable name
 * stands alone for the same reason, since there is nothing to compare.
 */
export function groupKeyFor(row: SystemPatient): string {
  if (searchBucket(row) === "orders") return `order:${row.id}`;
  const name = personKey(row.name);
  if (!name) return `alone:${row.id}`;
  return `p:${name}`;
}

/**
 * ⚠️⚠️ **MAY THESE TWO RECORDS BE CALLED ONE PATIENT?** — `nameMatchAccepted`'s
 * rule (§5.28), applied between two search rows rather than between a record
 * and an anchor. The caller has already established they share a name.
 *
 * ⚠️⚠️ **THE DOB BRANCH IS WHY JOSH STILL SAW FIVE ROWS.** §5.42 keyed on
 * `name|phone10`, so every record with a BLANK phone fell to `alone:<id>` — and
 * a completed record routinely carries a blank or differently-typed phone,
 * which is the entire reason `fetchDossierItems` runs a second, name-keyed pass
 * at all. A patient whose live record had a number and whose finished records
 * did not came back as one row per record, exactly as before the folding was
 * written. `SystemPatient` carries no DOB then; it does now (§5.46b).
 *
 * ⚠️⚠️ **AN AGREEING DOB FOLDS ACROSS A CHANGED NUMBER** (Josh, 2026-09-25).
 * The measured case: a subscribed patient whose phone was CORRECTED at Welcome
 * Call, so his three onboarding records carry the old number and his Welcome
 * Call + Subscription records the new one — same name, same DOB on all five —
 * and the old rule ("two non-blank phones that differ stay apart") rendered
 * him twice, a Completed row beside his Subscriptions row. Josh: *"make sure
 * that subscription profiles always end up showing one profile … any missing
 * holes in our intake process shouldnt mean two profiles show in search"*.
 * Name + DOB is still TWO signals, never a name alone; what changed is that a
 * differing phone no longer VETOES them — a number is the field reps correct
 * mid-pipeline, where a date of birth is not. Two same-named records whose
 * phones differ and whose DOBs are blank or differ still stand apart.
 * `nameMatchAccepted` (§5.28) follows the same rule, so the row this folds
 * into opens a patient screen that carries the whole trail.
 */
export function sameHuman(a: SystemPatient, b: SystemPatient): boolean {
  const pa = last10(a.phone);
  const pb = last10(b.phone);
  if (pa && pb && pa === pb) return true;
  const da = dobKey(a.dob);
  const db = dobKey(b.dob);
  return da.length > 0 && da === db;
}

/** Bucket order for picking the lead: a live record beats a stuck one, which
 *  beats a finished one. `orders` never reaches this — it never groups. */
const BUCKET_RANK: Record<SearchBucket, number> = { active: 3, stuck: 2, completed: 1, orders: 0 };

/**
 * Which of a person's records the row opens.
 *
 * ⚠️⚠️ **THE SUBSCRIPTION RECORD WINS OUTRIGHT** (Josh, 2026-09-22: *"it should
 * open up to their subscription page if they're on it, and the onboarding tab
 * if subscription profile does not exist"*). A patient who has reached
 * Subscription is being SERVED — the onboarding trail behind them is history —
 * so opening their Welcome Call record and making them press a toggle is
 * opening the wrong half of their record. The patient screen's view default
 * reads the same fact (`patientScreen.defaultView`), so the row and the screen
 * it opens cannot disagree.
 *
 * ⚠️ Below that it is the ACTIVE record, furthest along. A patient with no live
 * record opens on the stuck one if there is one (a manager decision is the
 * actionable thing), and otherwise on the furthest-along completed record,
 * which is where their history ends.
 */
export function pickLead(rows: readonly SystemPatient[]): SystemPatient {
  let best = rows[0];
  let bestScore = -1;
  for (const r of rows) {
    // Rank dominates the pipeline position, so a live Insurance record beats a
    // completed Welcome Call one: being worked outranks having been finished.
    // The Subscription board sits above both — it is not a pipeline stage.
    const sub = r.boardId === SUBSCRIPTION_BOARD ? 1000 : 0;
    const score = sub + BUCKET_RANK[searchBucket(r)] * 100 + (pipelineIndex(r.boardId) + 1);
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
 *
 * ⚠️ **Name first, then `sameHuman` WITHIN the name** — and transitively, so a
 * live record carrying a phone, a completed record carrying only a DOB and a
 * second completed record carrying both end up in one group however they are
 * ordered. Grouping on a single composite key cannot express "phone OR DOB";
 * this is the smallest thing that can.
 */
export function groupSearchHits(rows: readonly SystemPatient[]): PersonHit[] {
  const order: string[] = [];
  const byName = new Map<string, SystemPatient[][]>();

  for (const row of rows) {
    const key = groupKeyFor(row);
    let clusters = byName.get(key);
    if (!clusters) {
      clusters = [];
      byName.set(key, clusters);
      order.push(key);
    }
    // A name that cannot fold (an order row, or no name at all) is its own
    // cluster every time — `groupKeyFor` already made the key unique.
    const matches = key.startsWith("p:")
      ? clusters.filter((c) => c.some((other) => sameHuman(other, row)))
      : [];
    if (!matches.length) {
      clusters.push([row]);
      continue;
    }
    // ⚠️ MERGE every cluster this row bridges, rather than joining the first.
    // Two clusters can be the same person and not know it until a record
    // arrives carrying both their phone and their DOB.
    const merged = matches.flat();
    merged.push(row);
    for (const c of matches) clusters.splice(clusters.indexOf(c), 1);
    clusters.push(merged);
  }

  const hits: PersonHit[] = [];
  for (const key of order) {
    for (const group of byName.get(key)!) {
      const lead = pickLead(group);
      hits.push({
        // ⚠️ Keyed on the LEAD's item id, not on the name: two clusters under
        // one name would otherwise collide as React keys and the second row
        // would not render.
        key: `${key}#${lead.id}`,
        lead,
        rows: [lead, ...group.filter((r) => r !== lead)],
        name: lead.name || group.find((r) => r.name)?.name || "",
        phone: lead.phone || group.find((r) => r.phone)?.phone || "",
        bucket: searchBucket(lead),
      });
    }
  }
  return hits;
}

/**
 * The line under the name — what the patient is DOING.
 *
 * ⚠️ **No record count** (Josh, 2026-09-22: *"Shouldn't show the +4 more
 * records"*). §5.42 put one there so a folded row would not read like a patient
 * with a single record; from the floor it reads as clutter about our own data
 * model, on a line whose job is to tell a rep which patient this is. The extra
 * records are still all on the hit and still all reachable — they are the
 * stepper's per-record tabs, one click in.
 */
export function hitCaption(hit: PersonHit): string {
  return hit.lead.pipelineStage || hit.lead.groupTitle || hit.lead.boardName;
}

/**
 * ⚠️⚠️ **AN ORDER IS NOISE WHEN ITS PATIENT IS ALREADY ON SCREEN** (Josh,
 * 2026-09-23, on a name search that came back as one Subscription row and
 * three order rows: *"the data on those bottom 3 lines is already here in her
 * view so its not necessary / all we need is subscriptions"*).
 *
 * He is right, and the reason is the patient screen: its Orders tab lists
 * every order on the board for that patient — number, date, type, items,
 * status, shipped, delivered, each row a link (§5.45). So an order rendered
 * beside its own patient in an eight-row drop-down spends a slot to repeat
 * something one click away, and a patient with eight reorders crowds out
 * everybody else who matched.
 *
 * ⚠️ **A STANDALONE ORDER ROW STAYS, and that is the whole reason this is a
 * second pass rather than a change to `groupKeyFor`.** Josh asked for CAH, PO
 * and tracking-number search himself (§5.35), and the header's placeholder
 * promises "order #": those queries match the ORDER board and nothing else, so
 * there is no patient hit to fold into and the order row is the only way
 * through. Folding orders into the name bucket instead would also collapse
 * three orders of one patient into ONE row — and a rep who pasted one CAH
 * number would open whichever of the three sorted first.
 *
 * ⚠️ **Nothing is lost when one IS folded away.** The order stays in System
 * Management's Orders folder (its own tab, which is where Josh asked for them
 * — §5.35), on `/orders`, and on the patient's own Orders tab.
 */
export function orderFoldsInto(order: SystemPatient, hit: PersonHit): boolean {
  const name = personKey(order.name);
  if (!name) return false;
  if (!hit.rows.some((r) => personKey(r.name) === name)) return false;

  // ⚠️ A POSITIVE CONTRADICTION, not `sameHuman`'s agreement — the opposite
  // discipline, and deliberately so. `sameHuman` fails closed because
  // over-merging puts one patient's history under another's name; here the
  // only consequence of folding is a row that does not render in one
  // drop-down, with three other routes to it, while the consequence of NOT
  // folding is exactly the clutter being reported. The order board carries no
  // DOB (§5.44), so the phone is all there is to contradict with.
  const theirs = last10(order.phone);
  const ours = hit.rows.map((r) => last10(r.phone)).filter(Boolean);
  if (!theirs || !ours.length) return true;
  return ours.includes(theirs);
}

/** Drop the order hits whose patient is already a row on this list. */
export function foldRedundantOrders(hits: readonly PersonHit[]): PersonHit[] {
  const people = hits.filter((h) => h.bucket !== "orders");
  if (!people.length) return [...hits];
  return hits.filter(
    (h) => h.bucket !== "orders" || !people.some((p) => orderFoldsInto(h.lead, p)),
  );
}
